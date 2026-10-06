# Follow, contribute, accounts — and the data rules around them

## Recommendation in one line

Keep reading, building scenarios and sharing account-free forever. Add **Follow** and **Contribute** in v0 without accounts. Add optional accounts in v1, only for synced follows and contributor credit. Never build public profiles of who follows what.

## Why "follow", not "favourite"

A favourite is a bookmark; people rarely come back to bookmarks. The value of a promise ledger is the **moment of change**: "Deadline passed: £2 bus cap — no scheme open", "Funded in the Autumn Budget", "Reworded: £2 → £2.50". Follow = an alert when a card's status, timeline or cost changes. That is the retention loop and the reason to come back.

What can be followed: a promise, an actor (all their promises), a policy area, a deadline window ("everything due this quarter").

## Why contributions matter more than likes

The bottleneck of the product is intake speed and timeline freshness. A reader who saw a minister promise something on TV last night, or spotted that a bill passed, is a free sensor. Two contribution types:

1. **New promise:** link (required), time in video, who, the words, optional email.
2. **Evidence on an existing card:** link + what changed (reworded / in a plan or bill / funded / started / delivered / dropped).

Neither publishes anything directly. Both go to the editors' queue (see `PROMISE_STANDARD.md` §8).

## The data problem: following reveals political opinions

Under UK GDPR, data revealing political opinions is special category data (Article 9). A list "this email follows Reform UK's promises" plausibly reveals political opinions. So does a contributor's submission history. Consequences:

* Lawful basis: explicit consent at the point of subscribing, in plain words. Get legal confirmation; do a DPIA before launch.
* Data minimisation: store only email + followed IDs. No names, no profiles, no tracking pixels in alert emails, no third-party analytics on logged-in pages.
* Never show individual follows. Aggregates only, and only above a threshold (e.g. "1,200 people follow this", hidden below 50).
* Separate storage for subscriber emails, encrypted at rest, with a one-click delete that really deletes.
* No ads, ever, and no sale or sharing of lists. State it on the page.
* Self-host fonts and avoid third-party scripts on any page with a form (Google Fonts transmits visitor IPs to Google).

## Channel plan

| Channel | Account? | Stores | Phase |
|---|---|---|---|
| RSS/Atom per promise, actor, area | No | Nothing | v0 |
| Email alerts (double opt-in) | No | Email + followed IDs | v0 |
| Telegram bot | No | Telegram chat ID + followed IDs | v0 (essential for Russia mode) |
| Web push | No | Push endpoint + followed IDs | v1 |
| Account (passkey or magic link) | Yes | Email, followed IDs, submission history, optional public handle | v1 |

## Submissions without accounts

* Anonymous allowed. Abuse controls: Cloudflare Turnstile (or similar privacy-friendly CAPTCHA), rate limit per IP hashed with a daily salt, URL deduplication.
* Automatic checks on arrival: URL reachable; snapshot to the Internet Archive; for video, fetch captions/transcript and exact-match the quote; LLM pre-fills parameters for the editor (never publishes).
* Optional email: for credit and a status update ("your submission became card #123").
* Contributor credit is opt-in, by handle, never by default.

## Accounts (v1)

* Passkeys first, email magic link as fallback. No passwords, no social login (social login leaks the follow graph to the provider).
* Reputation: accepted submissions increase a contributor's trust level. Trusted contributors get their submissions reviewed first. Nobody gets publish rights; the two-editor rule stays.
* Voting on "cost this next" (which promises to assess first) needs accounts to resist brigading. Tie-in with Project 1: verified members can vote on priorities; votes change queue order, never findings.

## What we will not build in v0–v1

* Comments. They are a moderation sink and a defamation surface. Right of reply for actors covers the legitimate need.
* Public user profiles or follower lists.
* Likes/upvotes on findings (popularity must not affect a card's status).

## Russia mode

Accounts off. Follow via RSS and Telegram bot only. Submissions anonymous by default: no IP logging at all, metadata stripped from uploads, Tor-reachable form, no request for real names, editors outside Russia. A list of people tracking Kremlin promises is a danger to them, so the product must be unable to produce one.
