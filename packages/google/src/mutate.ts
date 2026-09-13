import type { GoogleAdsClient } from "./http.js";

/**
 * Atomic multi-resource writes via GoogleAdsService.Mutate.
 *
 * The whole reason this package hand-rolls the API rather than issuing one call
 * per resource: `googleAds:mutate` takes operations across different resource
 * types in a single request, lets a child reference a parent created in the
 * same request by a *temporary resource name*, and applies the batch atomically.
 * A budget-then-campaign-then-adGroup launch either lands whole or not at all,
 * so a mid-flight failure cannot orphan entities the way LinkedIn's
 * non-transactional launch can.
 */

/** One entry in `mutateOperations`, e.g. `{ campaignOperation: { create: {...} } }`. */
export type MutateOperation = Record<string, unknown>;

export interface MutateResponse {
  mutateOperationResponses?: Record<string, { resourceName?: string }>[];
  partialFailureError?: unknown;
}

/** Dollars to micros, the unit every money field on this API uses. */
export const toMicros = (amount: number | string): number =>
  Math.round(Number(amount) * 1_000_000);

/** Micros back to dollars. */
export const fromMicros = (micros: number | string): number =>
  Math.round((Number(micros) / 1_000_000) * 100) / 100;

/**
 * Accumulates operations and hands out temporary resource names.
 *
 * Temp ids are negative and must be unique across the whole request, even
 * between resource types, so one counter serves every collection. Google
 * resolves them in order, so a parent must be added before any child that
 * references it — which the ordering of `create` calls naturally enforces.
 * Only resources a later operation points at get a temp name; leaves go through
 * `add` with no name at all (see there for why).
 */
export class MutateBatch {
  private readonly ops: MutateOperation[] = [];
  private counter = 0;

  constructor(readonly customerId: string) {}

  /**
   * Append a create and return the temporary resource name to point children at.
   * `operationField` is the mutateOperations key (e.g. "adGroupOperation") and
   * `collection` the resource-name segment (e.g. "adGroups").
   */
  create(operationField: string, collection: string, resource: Record<string, unknown>): string {
    this.counter += 1;
    const resourceName = `customers/${this.customerId}/${collection}/-${this.counter}`;
    this.ops.push({ [operationField]: { create: { resourceName, ...resource } } });
    return resourceName;
  }

  /**
   * Append a create for a resource nothing else in the batch references, and
   * so needs no temporary name. Composite-key resources (campaign criteria,
   * ad group criteria, ad group ads, campaign shared sets) have ids of the form
   * `parent~child`, and Google rejects a bare negative id on them with
   * BAD_RESOURCE_ID. Leave the name off and Google assigns it.
   */
  add(operationField: string, resource: Record<string, unknown>): void {
    this.ops.push({ [operationField]: { create: resource } });
  }

  /** Append a partial update. `updateMask` lists exactly the fields being set. */
  update(operationField: string, resource: Record<string, unknown>, updateMask: string): void {
    this.ops.push({ [operationField]: { update: resource, updateMask } });
  }

  get operations(): MutateOperation[] {
    return this.ops;
  }

  get size(): number {
    return this.ops.length;
  }
}

/**
 * Send a batch. With `validateOnly` Google runs the entire request through its
 * validators and persists nothing, which is a true server-side dry run and the
 * safest thing to do before every real write.
 */
export async function runMutate(
  client: GoogleAdsClient,
  batch: MutateBatch,
  opts: { validateOnly: boolean; partialFailure?: boolean } = { validateOnly: true },
): Promise<MutateResponse> {
  return client.request<MutateResponse>({
    method: "POST",
    path: `/customers/${batch.customerId}/googleAds:mutate`,
    body: {
      mutateOperations: batch.operations,
      validateOnly: opts.validateOnly,
      partialFailure: opts.partialFailure ?? false,
    },
    // A validate-only call changes nothing, so it must not be journaled.
    isRead: opts.validateOnly,
  });
}

/**
 * Pull the created resource names out of a mutate response, keyed by result
 * type ("campaignResult", "adGroupResult", ...). Values stay in request order.
 */
export function createdResourceNames(res: MutateResponse): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of res.mutateOperationResponses ?? []) {
    for (const [key, value] of Object.entries(entry)) {
      if (!value?.resourceName) continue;
      (out[key] ??= []).push(value.resourceName);
    }
  }
  return out;
}

/** Trailing numeric id from a resource name, e.g. ".../campaigns/123" -> "123". */
export const idFromResourceName = (resourceName: string): string => resourceName.split("/").pop() ?? "";
