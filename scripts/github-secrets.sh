#!/usr/bin/env bash
# Copy the alerts job's settings from Vercel (Production) into GitHub Actions
# secrets, so the job on GitHub can read followers and send alerts. Values
# pass from Vercel to GitHub through a private temporary file and are never
# printed. Run it from the repository folder after any of these change in
# Vercel; GitHub keeps only what the alerts job needs (docs/OPERATIONS.md §8).
#
#   scripts/github-secrets.sh
set -euo pipefail

REPO="${REPO:-xternal/public-ledger}"
NAMES="DATABASE_URL LEDGER_ENCRYPTION_KEY LEDGER_LOOKUP_PEPPER ALTCHA_HMAC_KEY SITE_URL MAIL_FROM MAIL_REPLY_TO RESEND_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME"

command -v vercel > /dev/null || { echo "The Vercel CLI is needed: npm i -g vercel, then vercel login" >&2; exit 1; }
gh auth status > /dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login" >&2; exit 1; }

tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
vercel env pull "$tmp" --environment=production --yes > /dev/null

value() { grep -E "^$1=" "$tmp" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

for name in $NAMES; do
  v=$(value "$name")
  if [ -n "$v" ]; then
    printf '%s' "$v" | gh secret set "$name" --repo "$REPO"
    echo "set    $name"
  else
    echo "skip   $name (not set in Vercel, or marked sensitive there)"
  fi
done

provider=$(value MAIL_PROVIDER)
gh variable set MAIL_PROVIDER --repo "$REPO" --body "${provider:-off}"
echo "set    MAIL_PROVIDER variable: ${provider:-off}"
echo "Done. The next alerts run uses these; start one with: gh workflow run alerts.yml --repo $REPO -f task=digest -f dry_run=true"
