# Liam skills

Portable playbooks that run on top of Liam. Each skill is a `SKILL.md` an agent
(Claude Code personal skills, or anything that reads the same format) can load, and
each encodes a full methodology: what to pull, how to judge it, significance floors,
the caveats to state, and a fixed report format. They work over the Liam MCP tools
when registered, and fall back to the `liam` CLI, so they run anywhere Liam is
installed and authenticated.

The analysis and monitoring skills are read-only against your ad account. The ones
that write (liam-launch, gads-launch, and liam-experiments when it recreates an ad)
create drafts or paused entities only, after explicit confirmation; Liam has no
activate capability at all, on either platform.

**Analyze**

| Skill | Ask it | What you get |
| --- | --- | --- |
| `liam-spend` | "Analyze my spend" | Where budget goes, concentration, a summed wasted-spend figure, reallocation moves |
| `liam-performance` | "How are my ads doing?" | Full review: scoreboard, winners, losers, fatigue, scale/pause/watch actions |
| `liam-leads` | "Which ads drive leads? Which don't?" | Drivers table, pause list with dollars burned, converting vs dead copy angles |
| `liam-competitors` | "What is <company> running?" | Ad Library teardown: themes, offers, formats, cadence, EU targeting, gaps to exploit |

**Monitor**

| Skill | Ask it | What you get |
| --- | --- | --- |
| `liam-weekly` | "Weekly snapshot" | Fixed-format week-over-week snapshot, movers, flags, 3 actions; schedule-friendly |
| `liam-health` | "Anything on fire?" | Silent-unless-fire daily guardrails; one line when all clear; built for a morning schedule |

**Operate**

| Skill | Ask it | What you get |
| --- | --- | --- |
| `liam-launch` | "Launch a campaign for..." | Brief gathering, reach estimate, house guardrails, confirmed draft creation, activation handoff |
| `liam-experiments` | "Did that change help?" | Hypothesis logging, before/after lift, honest verdicts with confounds stated |
| `liam-audiences` | "Audit my audiences" | Inventory, health (stuck, small, stale, orphaned), dry-run uploads, Salesforce refresh loop |
| `liam-account-audit` | "Is my account set up right?" | Hygiene scorecard: naming, conversions, toggles, overlap, UTMs, plus a ranked fix list |

**Google Ads**

| Skill | Ask it | What you get |
| --- | --- | --- |
| `gads-launch` | "Launch a Google search campaign for..." | Keyword research with volume and bid ranges, house guardrails, server-side dry run, confirmed paused campaign, activation handoff |

## Install

Prerequisite: Liam set up and authenticated (see the repo README's Install section).

```bash
./skills/install.sh          # symlinks each skill into ~/.claude/skills
./skills/install.sh --copy   # copies instead, if you prefer no symlinks
```

Symlinking keeps the skills in lockstep with the repo: a `git pull` updates them in
place. Restart your Claude Code session afterwards so it discovers the new skills.
Set `CLAUDE_SKILLS_DIR` to install somewhere other than `~/.claude/skills`.

## Conventions (for adding skills)

- Directory name matches the frontmatter `name`, prefixed `liam-` (LinkedIn) or
  `gads-` (Google Ads).
- Frontmatter `description` says what it does and lists the trigger phrases.
- Skills synthesize; they never dump raw report rows back at the user.
- State the judgment floors (impressions, conversion counts) and the conversion-lag
  caveat rather than presenting every number as settled truth.
- Read-only by default; anything that writes (even drafts) requires explicit user
  confirmation inside the skill flow.
