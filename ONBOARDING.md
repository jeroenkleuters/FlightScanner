# Welcome to the FlightScanner Team

## How We Use Claude

Based on Jeroen Kleuters' usage over the last 30 days:

Work Type Breakdown:
  _TODO — no sessions were found in the last 30 days, so there's no usage data to
  break down yet. Fill this in once there's a few weeks of history, or replace it
  with the work types this team actually does._

Top Skills & Commands:
  _TODO — no slash-command usage recorded in the scan window. The project ships a
  full Blueprint skill set (see "Skills to Know About" below)._

Top MCP Servers:
  _None configured in the scan window._

## Your Setup Checklist

### Codebases
- [ ] FlightScanner — the main project (AI Blueprint workflow layer). Ask Jeroen for the repo URL.
- [ ] Websockets — sibling project in the same workspace folder
- [ ] coding-with-ai — sibling project in the same workspace folder
- [ ] devstash — sibling project in the same workspace folder

### MCP Servers to Activate
- [ ] _None yet — nothing to set up here._

### Skills to Know About

The project defines its own Blueprint skills under `.claude/skills/`. The ones a new
teammate hits first:

- `/onboard` — walks you through this project's Blueprint workflow from inside the repo
- `/overview` — loads the project's source of truth so Claude has context before you ask for work
- `/status` — where the current feature stands
- `/feature`, `/implement`, `/complete` — the normal build loop: define one feature, build it, close it out
- `/fix`, `/debug`, `/rollback` — the repair path
- `/tests`, `/check`, `/audit`, `/ci` — quality gates before anything ships
- `/doctor` — run this when the workflow misbehaves or `blueprint/config.json` looks wrong
- `/prototype`, `/discovery`, `/brief` — early exploration before committing to a feature
- `/autopilot`, `/continuous` — the automated modes; read the config policy before using them
- `/release`, `/try`, `/browser-tests`, `/adopt` — shipping and verification

## Team Tips

- Read `AGENTS.md` first — it's the cross-tool source of truth, and `CLAUDE.md` just imports it.
- **No AI attribution on commits or PRs** in this project. No `Co-Authored-By` trailers, no
  generated-by signatures. Preserve real human attribution.
- `blueprint/config.json` tunes strictness, never permissions. It can't authorize committing,
  pushing, merging, deleting data, or waiving a failing check — those always need a human.
- Never scaffold a framework (create-next-app, Vite) inside a folder that already has the
  blueprint files. Scaffold in an empty folder first, then overlay.
- _TODO — anything else you'd tell a new teammate?_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
