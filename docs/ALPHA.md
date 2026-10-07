# Alpha: deploy Public Ledger and try it

The alpha is the site as built so far, live on the web: public and crawlable (search engines and AI assistants may read it, `llms.txt` included), with an "Alpha" banner on every page saying the promise cards have not yet had their editor review.

| Works in the alpha | Off until set up (see docs/OPERATIONS.md) |
|---|---|
| Statement, sandbox, promise ledger, actor pages | Email alerts and receipts (Amazon SES): the site hides email options |
| Who gains and loses (PolicyEngine), People like me | Telegram bot: hidden until its token is set |
| Follow by RSS, feeds | Weekly digest and instant alerts (need email or Telegram) |
| Send us a promise / evidence, editors' triage at `/admin` | Draft pull requests from triage (shows the YAML to copy until `GITHUB_TOKEN` is set) |

Everything the site stores (submissions, follows later, T1 cache) goes to a Neon Postgres database in London; functions run in London (`lhr1`).

## Steps (about 15 minutes)

1. **Neon** (neon.tech, sign in with GitHub): create a project in **AWS Europe West 2 (London)**. Copy the **pooled** connection string (its host contains `-pooler`). Tables are created on first use.
2. **Vercel** (vercel.com, sign in with GitHub): *Add New → Project → Import* `xternal/public-ledger` (allow Vercel's GitHub app to see this private repository). Set **Root Directory** to `apps/web`; leave everything else as detected (the install and build commands come from `apps/web/vercel.json`). Press **Deploy**. This first deploy has no settings yet, so its server features will not work; the next step fixes that. Note the project name (default `public-ledger`) and the domain Vercel shows (default `public-ledger.vercel.app`, or a variant if taken).
3. **Settings and deploy**, in your own terminal, from the repository folder:
   ```bash
   scripts/alpha-setup.sh
   ```
   It signs you in to Vercel, links the folder to the project, asks for the site address and the Neon connection string (and, optionally, an Anthropic key for submission pre-fill), generates the keys and the editors' password on your machine, stores everything as Vercel environment variables, keeps a copy in `.env.alpha.local` (git-ignored; put it in your password manager), deploys, and prints the URL. If your project is not called `public-ledger`, run `VERCEL_PROJECT=<name> scripts/alpha-setup.sh`.
4. **Open the URL.** `/api/health` should answer `{"ok":true}`.

From then on every merge to `main` redeploys the alpha.

## Options

- **Close it to testers only:** set an `ALPHA_PASSWORD` (12+ characters) in Vercel and redeploy. Every page then asks for it once (a 30-day cookie), and nothing is indexed. Remove the variable to open it again.
- **Turn email on:** set up SES (docs/OPERATIONS.md §3), then set `MAIL_PROVIDER=ses`, `MAIL_FROM` and the AWS keys in Vercel.
- **Alerts and intake against the alpha's database:** add `DATABASE_URL` and the same keys as GitHub Actions secrets (docs/OPERATIONS.md §8). Leave them out until email is on.
