---
name: liam-competitors
description: Research any company's LinkedIn ads through Liam's Ad Library integration and synthesize how their account is run. Messaging themes, offers and CTAs, format mix, cadence, EU impression and targeting data, plus gaps worth exploiting. Single competitor or side-by-side. Use for "what ads is X running", "research competitors", "competitor ad teardown", "compare our ads to theirs".
---

# Liam: competitor ad research

The deliverable is a strategy read, never the ad list itself. Read the copy, formats,
targeting, and cadence, then explain how the competitor runs their account and what
that means for the user's own ads.

## How to reach Liam

Prefer the `liam` MCP tool `inspect_competitor_ads` if loaded. Otherwise the CLI:
`liam competitor ads <advertiser>` (or `node <liam-repo>/packages/cli/dist/index.js
competitor ads ...`). No ad-account access is needed; this reads the public LinkedIn
Ad Library.

## Getting the right ads

- **Name vs company id.** A name search is broad and pulls in partners and resellers
  ("HubSpot" also returns HubSpot solution partners). For exactly one company's ads,
  use the numeric company id or a `linkedin.com/company/<id>` URL (scraper engine), or
  post-filter API results by the advertiser/payer field.
- **Engines.** `auto` (default) uses the official API for metadata and layers ad copy
  from each ad's detail page; `api` is metadata-only but fast and works without a
  local browser (the only engine on a hosted MCP); `scraper` drives a local Chrome and
  gets copy without the API grant.
- **Volume.** Default cap is 50 ads; raise `--max` for big advertisers (the API
  reports the advertiser-wide total, quote it for context). Metadata from the API is
  cheap at any size. Copy is not: every ad's copy is a browser visit to LinkedIn from
  the user's own IP, so Liam opens at most `copyMax` (50) detail pages per run, one at
  a time with a pause. For a big advertiser, pull metadata at a high `--max` and read
  copy from the capped sample; raise `copyMax` only when the user asks for more copy
  and knows the cost.
- **If LinkedIn blocks the scraper.** Liam stops at the first Cloudflare block and
  reports it in `note`. Treat that as final for the session: do not retry the scraper,
  and never probe the pages with curl, fetch, or a browser-automation tool. The block
  is on the IP and also locks the user out of the Ad Library in their own browser for
  a few hours. Say so, hand over the metadata read, and offer to fetch copy later or
  from another network.
- **EU bonus data.** Ads served in the EU carry run dates, impression ranges,
  per-country splits, and structured targeting facets. Use them; they are the closest
  thing to seeing a competitor's media plan.

## Synthesis framework

Work through these dimensions and ground every claim in specific ads (quote short copy
snippets):

1. **Messaging themes.** The 2-4 recurring value props or narratives across the ads.
2. **Offers and CTAs.** What they ask for: demo, trial, report, webinar, event. The
   offer mix reveals which funnel stage they are buying.
3. **Format mix.** Single image vs video vs carousel vs document vs thought-leader
   ads, roughly proportioned.
4. **Who they spotlight.** Executives, customers, partners, product screenshots.
5. **Cadence and scale.** How many ads run concurrently, how often new ones ship
   (run dates where available), impression volume and geography.
6. **Targeting** (EU data where present): languages, locations, company and job
   facets, notable exclusions.

## Comparing several competitors

Run each pull separately, then produce one comparison: a table across the dimensions
above, then a strategic read of who spends hardest, whose positioning overlaps the
user's, and which offer types nobody in the set is running.

## Report format

- **How they run it:** one paragraph per competitor summarizing the account strategy.
- **Dimension findings:** themes, offers, formats, spotlight, cadence, targeting, each
  with example ads quoted.
- **So what:** implications for the user's own account. Over-used angles to avoid,
  gaps worth testing, offers worth copying, formats they are ignoring. Make these
  specific enough to brief an ad from.
