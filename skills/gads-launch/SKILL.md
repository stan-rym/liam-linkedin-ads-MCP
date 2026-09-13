---
name: gads-launch
description: Create Google Ads Search campaigns through Liam with guardrails, from a plain-language ask to a keyword-researched brief to a paused campaign. Applies house defaults (search network only, presence-only geo, Manual CPC) and validates server-side before anything is written. Use for "launch a Google Ads campaign", "set up a search campaign", "run ads on these keywords", "build a Google campaign for".
---

# Liam: guarded Google Ads launch

Everything Liam creates on Google is **PAUSED**, and no tool or flag can create
an enabled campaign, ad group, or ad. On top of that, every write is validated
server-side first with `validateOnly`, which asks Google to run the whole batch
through its validators and persist nothing. So the cost of a mistake is rework,
not money. This skill's job is making rework rare.

## How to reach Liam

Prefer the `liam` MCP tools if loaded: `gads_list_accounts`, `gads_keyword_ideas`,
`gads_list_conversion_actions`, `gads_launch_search_campaign`, `gads_list_campaigns`,
`gads_performance`, `gads_search`. CLI fallback:

```bash
LIAM="node /Users/stanrym/linkedin-ads/packages/cli/dist/index.js"
$LIAM google accounts list
$LIAM google keywords "revops automation" --url https://www.default.com/platform
$LIAM google conversions list
$LIAM google launch --brief brief.json            # dry run
$LIAM google launch --brief brief.json --apply    # create it
```

If a command says there are no Google Ads credentials, Stan needs a developer
token (from a Google Ads **manager** account at ads.google.com/aw/apicenter) and
a Google Cloud OAuth client, then `liam google auth login`. That is a setup task,
not something to work around.

Naming map, because it differs from LinkedIn: Google's **campaign** holds the
budget and targeting (LinkedIn's ad group), its **ad group** holds keywords and
ads, and there is no campaign-group level.

## Step 1: gather the brief

Required before anything is created: campaign name, daily budget, landing URL,
the ad groups, and for each ad group its keywords and at least one responsive
search ad. Ask for what is missing rather than inventing it.

Name ad groups so the angle is legible (theme, match type, persona), because
later analysis reads intent off the names.

Display paths: `path2` requires `path1`. Google rejects `path2` on its own and
the brief schema refuses it before the call, so put a lone path segment in
`path1`.

## Step 2: research keywords before quoting anything

Never accept a keyword list at face value. Run `gads_keyword_ideas` on the seeds
and the landing page, then report volume, competition, and the top-of-page bid
range. This is the step that catches a term nobody searches and a term that
costs $60 a click.

- Quote the bid range against Stan's proposed max CPC. If the bid range sits
  above it, say so plainly: the keyword will not serve.
- Default to EXACT and PHRASE for B2B. BROAD without a strong negative list is
  how Google budgets disappear.
- Propose negatives from what the research surfaces (jobs, salary, free, course,
  tutorial, competitor brand terms Stan does not want to bid on).

## Step 3: state the house rules being applied

These are hard-coded and cannot be overridden. Say them out loud in the
confirmation so Stan knows what he is getting:

- **Search network only.** Display expansion and search partners off. This is
  the Google equivalent of Audience Expansion and Audience Network off, and it
  is the single biggest silent waste leak on a B2B search campaign.
- **Physical presence only.** Location targeting is `PRESENCE`, not the default
  presence-or-interest, so "US" means people in the US rather than people
  anywhere who searched about it.
- **Manual CPC to start.** Smart bidding on a campaign with no conversion
  history spends unpredictably. Switch to conversion bidding in the UI once
  there is data.
- **A daily budget is required.** No brief without a stated cap.

A shared negative-keyword list is deliberately *not* a default. Attach one only
when Stan names it (`negativeKeywordListId`).

## Step 4: wire conversions, and be honest about the gap

Run `gads_list_conversion_actions` and name the right one in
`conversionActionNames` (or set `defaultConversionActionNames` in
`~/.liads/google.json`). Liam verifies the action exists and warns if it does
not.

Be straight about what this does and does not do: Liam **verifies** the
conversion actions but does not set per-campaign conversion goals at creation.
Google applies the account-level goals by default, and under Manual CPC
conversion goals do not affect bidding at all. If this campaign should optimize
for a narrower set than the account default, that is a UI step after creation.
Say this in the handoff rather than implying it is wired.

## Step 5: dry run, confirm, then create

1. Call `gads_launch_search_campaign` with `validateOnly: true` (the default).
   Google validates the entire batch and creates nothing.
2. Show the returned `plan` (budget, campaign, targeting, each ad group with its
   keyword and ad counts), the operation count, and every warning.
3. Only after Stan confirms, call again with `validateOnly: false`.

If validation fails, the error names the exact field path (for example
`operations[0].create.campaign_budget`). Fix the brief and re-validate; do not
retry blind.

The whole launch is a single atomic mutate, so a failure creates nothing at all.
There is no orphan cleanup to worry about, unlike the LinkedIn path.

## Step 6: verify and hand off

- `gads_list_campaigns` to confirm the tree exists, and report every id.
- Tell Stan the four things to eyeball in the Google Ads UI, because they are
  the ones that cost money if wrong: status is Paused, networks are Search only,
  location targeting says *presence*, and the budget is what he asked for.
- Hand off activation explicitly. Liam never enables anything; turning the
  campaign on is a human action in the UI.
- The launch is journaled automatically to `~/.liads/changelog.jsonl` alongside
  LinkedIn changes, so `liam changelog list` shows both.

## What this skill does not do

Performance Max, Display, Shopping, and video campaigns are not supported;
Liam builds Search campaigns only. Customer Match audience upload is not built
yet either. Say so rather than improvising with raw GAQL.
