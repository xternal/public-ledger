# Operations: running Follow and Contribute (M3b)

Reading the site needs nothing on this page. Follow (email and Telegram alerts),
Contribute (reader submissions) and the editors' triage need a database, a mail
sender, a Telegram bot and a few secret keys. Locally, all of it runs without
accounts: an in-process database, mail written to a table, Telegram messages
captured. This page is the production setup, in the order to do it.

Everything below needs an account in the owner's name. Claude does not create
accounts or handle the keys; it wrote the code that reads them from environment
variables (`apps/web/.env.example` lists them all).

## Where the data lives

| Thing | Provider | Region | What is stored |
|---|---|---|---|
| Subscriptions, submissions, counts | Neon Postgres | AWS eu-west-2 (London) | Encrypted addresses, followed ids, submissions; no IPs, no names |
| Alert and receipt emails | Amazon SES | eu-west-2 (London) | Nothing kept beyond SES's own sending logs; no open or click tracking |
| Telegram alerts | Telegram Bot API | Telegram's servers | Chat id (encrypted on our side) |
| App and API | Vercel | Functions in `lhr1` (London) | Nothing; stateless |
| Alerts job | GitHub Actions | GitHub | Nothing; reads secrets, talks to Neon, SES and Telegram |

## 1. Keys you generate yourself

Run each once, keep the output in a password manager, then paste it into Vercel
(Project → Settings → Environment Variables, Production) **and** GitHub
(repo → Settings → Secrets and variables → Actions).

```bash
openssl rand -base64 32
```

Use that command three times, for `LEDGER_ENCRYPTION_KEY`, `LEDGER_LOOKUP_PEPPER` and `ALTCHA_HMAC_KEY`.

```bash
openssl rand -hex 32
```

Use that for `TELEGRAM_WEBHOOK_SECRET` (Telegram accepts only letters, digits, `_` and `-`).

**Do not lose or change `LEDGER_ENCRYPTION_KEY` or `LEDGER_LOOKUP_PEPPER`.**
Losing the first makes every stored address unreadable, so nobody gets alerts
until they follow again. Changing the second breaks "is this address already
subscribed", which creates duplicates. Rotating them needs a migration; ask
before doing it.

## 2. Database: Neon (London)

1. Create a Neon project in region **AWS Europe West 2 (London)**.
2. Create a database `ledger`. Copy the **pooled** connection string (host contains `-pooler`).
3. Set `DATABASE_URL` in Vercel and GitHub. Tables are created automatically on
   first use (migrations in `packages/server/src/migrations`).
4. Turn on Neon's point-in-time restore (on by default on paid plans) and note
   the retention.

## 3. Mail: Amazon SES (London)

1. In the AWS console switch to **eu-west-2 (London)**, open SES.
2. Verify the sending **domain** (not a single address): add the three DKIM
   CNAME records it gives you; set a custom MAIL FROM subdomain; publish SPF and
   a DMARC record (`p=quarantine` once mail flows cleanly).
3. Request **production access** (leave the sandbox). Describe the mail as
   "double opt-in alerts about public political promises, plain text, one-click
   unsubscribe, low volume".
4. Do **not** enable open or click tracking (no configuration set with tracking).
   Our mail is plain text with no images, so there is nothing to track anyway.
5. Create an IAM user (or, later, an OIDC role) allowed only `ses:SendEmail` on
   that identity. Put its keys in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
6. Set `MAIL_PROVIDER=ses`, `MAIL_FROM` (e.g. `Public Ledger <alerts@your-domain>`),
   optionally `MAIL_REPLY_TO`.

## 4. Telegram bot

1. In Telegram, message **@BotFather** → `/newbot`. Note the token and the
   username. Set `/setdescription` and `/setabouttext` to say what it stores
   (the chat id and what you follow, encrypted; `/stop` deletes it).
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
3. After the site is deployed, register the webhook once (replace the three values):

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://YOUR-SITE/api/telegram" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]'
```

## 5. Claude API (submission pre-fill)

Create a key in the Anthropic Console, set a monthly spend limit, and set
`ANTHROPIC_API_KEY`. Without it, submissions still work; editors just don't get
suggested fields. The model's output is a suggestion for editors and never
changes a card.

## 6. Editors' triage (`/admin`)

* Interim: set `ADMIN_USER` and `ADMIN_PASSWORD` (long, random). With either
  unset, `/admin` returns 404.
* **Before launch**, put real sign-in in front: Vercel Authentication (Vercel
  plan with deployment protection for a path) or Cloudflare Access (free for
  small teams; email one-time codes or Google/Microsoft accounts).
* For draft pull requests from triage, create a **fine-grained** GitHub token for
  this repository only, with Contents and Pull requests read/write, and set
  `GITHUB_TOKEN`. Without it, triage shows the YAML to copy.

## 7. Vercel project

* Root directory `apps/web`; install with pnpm (corepack); Node 22.
* Functions region **London (`lhr1`)** so personal data is processed in the UK.
* Environment: `LEDGER_ENV=production`, `SITE_URL`, and every variable above.
  With `LEDGER_ENV=production`, the app refuses to start if a required secret is
  missing, rather than running with development defaults.
* Uptime check: `GET /api/health` returns `{"ok":true}` when the database answers.

## 8. Alerts job (GitHub Actions)

`.github/workflows/alerts.yml` runs:

* on every push to `main` that changes `content/` → detects changes and sends
  instant alerts (a few minutes end to end; the target is 15);
* weekly digest every Monday 07:00 UTC (08:00 BST; 07:00 GMT after the clocks
  go back on 2026-10-25);
* daily maintenance: deletes unconfirmed sign-ups after 7 days, delivery
  records after 35 days, yesterday's rate-limit salts and buckets.

Without `DATABASE_URL` set as a secret, the job logs "Alerts not configured" and
succeeds, so it is safe to merge before setup.

## 9. Before going public (not code)

* **DPIA** (data protection impact assessment) for follows, which are special
  category data under UK GDPR Article 9.
* **Legal review** of the consent text (`packages/server/src/follow/consent.ts`)
  and the privacy notice.
* ICO registration (data protection fee) for the controller.
* Editors and a lawyer read the cards (see `docs/reviews/`).
