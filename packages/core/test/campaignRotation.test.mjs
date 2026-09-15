import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, updateCampaign, CampaignInputSchema, CampaignUpdateSchema, LaunchFromBriefSchema } from '../dist/index.js';

function fakeClient(restliId = '123') {
  const calls = [];
  return { calls, request: async (req) => { calls.push(req); return { data: {}, restliId }; } };
}

test('creativeSelection accepts only OPTIMIZED or ROUND_ROBIN', () => {
  assert.equal(CampaignUpdateSchema.parse({ accountId: '1', campaignId: '2', creativeSelection: 'ROUND_ROBIN' }).creativeSelection, 'ROUND_ROBIN');
  assert.throws(() => CampaignUpdateSchema.parse({ accountId: '1', campaignId: '2', creativeSelection: 'ROTATE_EVENLY' }));
  assert.throws(() => CampaignInputSchema.parse({ accountId: '1', campaignGroupId: '2', name: 'x', runSchedule: { start: 1 }, creativeSelection: 'EVEN' }));
  assert.equal(LaunchFromBriefSchema.parse({ accountId: '1', campaignGroupName: 'g', campaignName: 'c', dailyBudget: { amount: '1', currencyCode: 'USD' }, runSchedule: { start: 1 }, creativeSelection: 'ROUND_ROBIN' }).creativeSelection, 'ROUND_ROBIN');
});

test('updateCampaign patches creativeSelection and nothing else', async () => {
  const client = fakeClient();
  const dry = await updateCampaign(client, { accountId: '1', campaignId: '42', creativeSelection: 'ROUND_ROBIN', dryRun: true });
  assert.deepEqual(dry.updated, ['creativeSelection']);
  assert.deepEqual(dry.patch, { creativeSelection: 'ROUND_ROBIN' });
  assert.equal(client.calls.length, 0);

  const res = await updateCampaign(client, { accountId: '1', campaignId: '42', creativeSelection: 'OPTIMIZED' });
  assert.deepEqual(res.updated, ['creativeSelection']);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].path, '/adAccounts/1/adCampaigns/42');
  assert.equal(client.calls[0].headers['X-RestLi-Method'], 'PARTIAL_UPDATE');
  assert.deepEqual(client.calls[0].body, { patch: { $set: { creativeSelection: 'OPTIMIZED' } } });
});

test('createCampaign sends creativeSelection when given and omits it otherwise', async () => {
  const base = {
    accountId: '1', campaignGroupId: '9', name: 'rotation test', runSchedule: { start: 1 },
    geoUrns: ['urn:li:geo:103644278'], applyDefaultExclusions: false, applyDefaultConversion: false,
    type: 'SPONSORED_UPDATES', costType: 'CPM', locale: { country: 'US', language: 'en' }, status: 'DRAFT', politicalIntent: 'NOT_POLITICAL',
  };
  const a = fakeClient('555');
  await createCampaign(a, { ...base, creativeSelection: 'ROUND_ROBIN' });
  assert.equal(a.calls[0].body.creativeSelection, 'ROUND_ROBIN');
  assert.equal(a.calls[0].body.audienceExpansionEnabled, false);
  assert.equal(a.calls[0].body.offsiteDeliveryEnabled, false);

  const b = fakeClient('556');
  await createCampaign(b, base);
  assert.equal('creativeSelection' in b.calls[0].body, false);
});
