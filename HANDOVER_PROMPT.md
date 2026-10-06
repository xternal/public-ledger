# Handover prompts

A handover prompt is the first message you paste into a fresh tool or give to a new person, so they can start without this conversation. Everything they need is in this repo; the prompt tells them what to read, what to build first, and what "done" means.

Two prompts below. Unzip the pack into an empty git repo first.

---

## 1. Claude Code — kick-off (paste as the first message)

```
You are starting work on Public Ledger, an open P&L of the UK state: a Sankey of public income and spending, a policy sandbox that turns any proposal into ranged consequences, and a ledger of political promises with cost, funding and a status timeline.

Before writing any code, read in this order:
1. CLAUDE.md (invariants, stack, repo layout) — these rules override your defaults.
2. README.md (concept and why the modules are linked: a promise card is a sandbox scenario plus a timeline).
3. docs/PRE_SHIP_REVIEW.md (known issues; do not reintroduce any marked fixed).
4. docs/PRD.md, docs/DATA_MODEL.md, docs/MODEL.md.
5. prototype/index.html in a browser, and prototype/template.html as the reference implementation (compute(), debtPath(), renderSankey()).

Then do milestone M0 from docs/BUILD_PLAN.md exactly as written:
- pnpm monorepo: apps/web (Next.js App Router, TypeScript strict, Tailwind), packages/engine, packages/schema.
- Port the prototype into React components with the same look (see docs/DESIGN_HANDOFF.md "Visual direction" and tokens).
- Data only from data/seed/*.json through Zod schemas. No numeric literals in components.
- Engine in packages/engine with Vitest tests: statement balances for base and 20 random scenarios; each lever at +1 unit reproduces its central per_unit_bn; bus cap with climate_loans funding nets to +£0.1bn.

Working rules:
- Show me a short plan first (files you will create, in order), then build.
- Commit after each green step with a clear message.
- If a number you need is missing, add it to data/seed with quality "training" and a TODO(source) note. Never invent silently.
- Stop at the end of M0 and report: what works, test results, screenshots of desktop and mobile, and anything in the review doc you think M1 must address first.
```

For later milestones, open a new session and paste the matching prompt from `docs/BUILD_PLAN.md`, prefixed with: *"Read CLAUDE.md, README.md and docs/PRE_SHIP_REVIEW.md first."*

---

## 2. Designer — brief (send with the repo or the prototype link)

```
We are building Public Ledger: the annual report of the country for its 69 million shareholders, with a calculator next to every page and a credit history for every promise. UK pilot first.

Start with the clickable prototype (prototype/index.html or the shared link). The interaction model and information hierarchy are agreed. Your job is the polished system and the screens we have not drawn yet.

Read docs/DESIGN_HANDOFF.md. It has the principles, information architecture, the 10 screens in priority order, component states, current tokens and copy rules.

Direction: modern, clean, informational — a public data product, not a campaign site. White page, one typeface, numbers first, three data colours (income blue, spending grey, borrowing orange and hatched). It must stay neutral: no colour or wording that favours any party.

Highest priority:
1. Promise card page + its 1200×630 share image (this is the growth surface).
2. Home / Statement on mobile.
3. Sandbox as a mobile bottom sheet.
4. Follow and Contribute flows.

Deliver: Figma (or a Claude Design canvas) with desktop and mobile, light and dark; a component sheet with all states; share-image templates; an updated tokens file.
```
