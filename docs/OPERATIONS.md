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
| Alert and receipt emails | Resend (or Amazon SES) | Resend: eu-west-1 (Ireland); SES: eu-west-2 (London) | Nothing kept beyond the provider's own sending logs; no open or click tracking |
| Telegram alerts | Telegram Bot API | Telegram's servers | Chat id (encrypted on our side) |
| App and API (including the public `/api/v1`) | Vercel | Functions in `lhr1` (London) | Nothing; stateless. `/api/v1` is built from committed files at deploy and serves no database rows |
| Alerts job | GitHub Actions | GitHub | Nothing; reads secrets, talks to Neon, the mail provider and Telegram |

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

## 3. Mail: Resend (recommended) or Amazon SES

Mail needs a domain you own, for example `alerts@<your-domain>`: neither provider can send from `*.vercel.app`.

**Resend** (`MAIL_PROVIDER=resend`). It's simpler, and the owner already uses it on other projects.

1. In Resend, add the sending **domain** in the **EU region (eu-west-1, Ireland)**, and publish the DNS records it gives you (DKIM, SPF via a `send` subdomain, and a DMARC record: `p=quarantine` once mail flows cleanly).
2. On the domain, turn **open tracking and click tracking off**. Our mail is plain text with no images or rewritten links, and tracking would break the privacy promise.
3. Create an API key with **sending access** to that domain only.
4. Set `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (e.g. `Public Ledger <alerts@your-domain>`) and optionally `MAIL_REPLY_TO`, in Vercel and, for alerts, in GitHub Actions secrets.

**Amazon SES** (`MAIL_PROVIDER=ses`): keeps mail in London, at the cost of more setup.

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

## 10. Intake: daily promise drafts (GitHub Actions)

`.github/workflows/harvest.yml` runs every day at 06:15 UTC (07:15 BST; 06:15
GMT after the clocks go back on 2026-10-25), and by hand from the Actions tab
with an optional date. It reads the previous day's Commons statements, PMQs,
written ministerial statements and GOV.UK press releases; Claude proposes
candidate promises; only quotes found word for word in the source are kept.
Each day with candidates becomes one **draft** pull request labelled `intake`,
on a branch `intake/<date>`, with one YAML per candidate in
`content/drafts/<date>/` and the source texts beside them
(`content/README.md`, "Drafts").

* **Set up:** add the `ANTHROPIC_API_KEY` secret in GitHub (repo → Settings →
  Secrets and variables → Actions); the same key as §5 works, but a separate
  key with its own monthly spend limit shows intake costs on their own.
  Optionally set the repository *variable* `INTAKE_MODEL` to change the model.
  Without the key the job logs "Intake not configured" and succeeds.
* **The guarantee:** before the pull request opens, `pnpm validate` re-checks
  every draft's quote against its stored source, character for character. If
  that fails, no pull request opens and the run fails. CI on the pull request
  does the same check after every push.
* **CI on the pull request:** GitHub does not start workflows for pull requests
  opened by a workflow's own token, so CI first runs when an editor pushes to
  the branch.
* **Never merged automatically.** Two editors turn each draft into a card or
  delete it; the drafts folder must be gone before merge.
* **Running a day again:** the job never overwrites an existing `intake/<date>`
  branch (it may hold editors' work). Close the pull request and delete the
  branch first, then run the workflow with that date.
* **Locally** (needs `ANTHROPIC_API_KEY` in your shell to extract):
  `pnpm harvest -- day --date 2026-10-06 --dry-run` prints the day's report and
  writes nothing; without `--dry-run` it writes the drafts and
  `content/drafts/<date>/PR.md` (the pull request text, not committed).
  `pnpm harvest -- upload …` does the same for a transcript or a YouTube
  video's captions.

## 11. OBR data by hand

OBR's website refuses GitHub's servers (its Cloudflare answers 403), so
the nightly data job reads OBR's pages and workbooks through the Internet
Archive instead (`etl/wayback.py`). It asks the
archive to capture each OBR address now ("Save Page Now") and reads the
archive's unmodified copy. Nothing changes for readers: the numbers still
cite obr.uk. The data pull request lists every file read this way, with the
time the archive captured it and the archive address it came from, under
**Read through the Internet Archive**. A landing page (where new editions are
found) must have been captured in the last 20 hours, so an old copy can never
hide a new edition.

The archive is not always available. When it can't supply a fresh copy, the
run keeps the committed OBR data and says so: a `fetch` warning on
`obr_databank` or `obr_efo` ending "run `pnpm etl` on your own machine…", and,
once the edition is overdue, a staleness warning and then an error. Then
refresh OBR from your own connection after each OBR release: the EFO arrives
with each Budget and Spring Statement (next: the Budget, expected November
2026); the databank about two working days after each monthly public sector
finances release.

1. Once per machine, set up the ETL environment (Python 3.14):

```bash
python3.14 -m venv etl/.venv && etl/.venv/bin/pip install -r etl/requirements.txt
```

2. Start from an up-to-date `main` on a new branch (use today's date):

```bash
git switch main && git pull --ff-only && git switch -c data/obr-2026-11-26
```

3. Run every source. OBR answers a home connection, so no archive is involved:

```bash
pnpm etl && pnpm backtest
```

`pnpm backtest` records the new edition's forecasts (the site will show
them) and scores anything whose outturn is now out (docs/MODEL.md "Backtest").
CI runs it too and fails if you forget.

4. Check that the run ends with `ok` and no `fetch` warnings for OBR, and that
   `data/build/observations/obr_efo/` (or `obr_databank/`) has the new
   edition's file. Then commit and open the pull request:

```bash
git add data/build && git commit -m "Data refresh: OBR, new edition"
```

```bash
git push -u origin HEAD && gh pr create --base main --title "Data refresh: OBR, new edition" --body "$(etl/.venv/bin/python -m etl.summary)"
```

Review the Statement diffs as for a nightly pull request. CI rebuilds from
the committed observations and fails if they don't reproduce the committed
bundle.

## 11. Merging when CI is green

The repository is private on GitHub's free plan, so `main` cannot require checks. Instead, label a pull request **`merge-when-green`**: `.github/workflows/merge-when-green.yml` merges it once the CI checks `app` and `data` are both green on its latest commit (never a newer, unchecked commit), and starts the alerts run when content changed. Vercel deploys the merge as usual. A pull request that changes `.github/workflows/` is the exception: GitHub does not let a workflow merge workflow changes, so the job leaves one comment asking for a hand merge (`gh pr merge <number> --repo xternal/public-ledger --merge`). Intake pull requests follow their own rule (approvals plus green CI, `.github/workflows/intake-merge.yml`). GitHub starts no workflow when an editor approves a pull request a workflow opened, so a sweep every 3 hours (17 minutes past 00, 03 … 21 UTC; an hour later in BST) merges approved intake pull requests; run the workflow by hand to merge one sooner.

```bash
gh pr edit <number> --repo xternal/public-ledger --add-label merge-when-green
```

## 12. Mac fallback for GitHub Actions

GitHub's machines run every job and bill the Actions budget. If they stop (in October 2026 a lapsed payment blocked every job for a morning), a Mac can run the same jobs for free. Every workflow says `runs-on: ${{ vars.RUNS_ON || 'ubuntu-latest' }}`, so one repository variable decides where jobs run, with no code change.

1. **Set up once**, in your own terminal on the Mac (Apple Silicon), from the repository folder:
   ```bash
   scripts/runner-setup.sh
   ```
   It downloads GitHub's runner (`actions-runner-osx-arm64-<version>.tar.gz`, about 130 MB, from github.com/actions/runner), checks it against the SHA-256 in the release notes, registers it with this repository under the label `ledger-mac`, and starts it as a background service that comes back when you log in. It lives in `~/actions-runner/public-ledger`. Jobs keep running on GitHub until you switch.
2. **Switch** when you need to, and back when GitHub works again:
   ```bash
   scripts/runner-switch.sh mac
   scripts/runner-switch.sh github
   scripts/runner-switch.sh status
   ```
3. **Remove** it entirely: `scripts/runner-setup.sh --remove` (this also switches jobs back to GitHub).

Caveats:

* **Keep the Mac awake** while it serves jobs (System Settings → Battery → Options: prevent sleeping when the display is off, on the power adapter). Jobs wait while it sleeps, and GitHub cancels a job that waits 24 hours. The nightly refresh is at 04:30 UTC (05:30 BST).
* **One job at a time.** CI's `app` and `data` checks run one after the other, so CI takes longer.
* **Private repository only.** A runner runs whatever a workflow gives it. The setup script refuses if the repository is public, because then anyone's pull request could run code on the Mac. If the repository ever goes public, run `scripts/runner-setup.sh --remove` first.
* **Secrets pass through the Mac** during jobs (the Anthropic key for intake, for example), as they pass through GitHub's machines. Each job gets a fresh checkout in `_work`; nothing is kept between jobs except tool caches.
* Jobs are written for both: the only Linux-only command (yesterday's date in the intake job) has a macOS branch.
