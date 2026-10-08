#!/usr/bin/env bash
# Copy the alerts job's settings into GitHub Actions secrets, so the job on
# GitHub can read followers and send alerts. Values never appear on screen.
#
#   scripts/github-secrets.sh
#
# Where each value comes from, in order:
#   1. Vercel Production (vercel env pull). Variables marked "sensitive" in
#      Vercel come back empty, so they are taken from the next place instead.
#   2. .env.alpha.local in the repository folder (written by
#      scripts/alpha-setup.sh; git-ignored): the encryption and lookup keys.
# Anything still missing is listed at the end with the command to paste it
# by hand (for example DATABASE_URL, from Neon: Open in Neon > Connect).
set -uo pipefail

REPO="${REPO:-xternal/public-ledger}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.env.alpha.local"
NAMES="DATABASE_URL LEDGER_ENCRYPTION_KEY LEDGER_LOOKUP_PEPPER ALTCHA_HMAC_KEY SITE_URL MAIL_FROM MAIL_REPLY_TO RESEND_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME"
# Without these the job cannot run; the rest are optional.
NEEDED="DATABASE_URL LEDGER_ENCRYPTION_KEY LEDGER_LOOKUP_PEPPER ALTCHA_HMAC_KEY SITE_URL MAIL_FROM RESEND_API_KEY"

command -v vercel > /dev/null || { echo "The Vercel CLI is needed: npm i -g vercel, then vercel login" >&2; exit 1; }
gh auth status > /dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login" >&2; exit 1; }

tmp=$(mktemp)
chmod 600 "$tmp"
trap 'rm -f "$tmp"' EXIT
vercel env pull "$tmp" --environment=production --yes --cwd "$ROOT" > /dev/null 2>&1 || echo "note   could not read Vercel's settings; using $LOCAL only"

# The value of NAME in a dotenv file, without quotes; empty when absent.
value_in() { { grep -E "^$1=" "$2" 2> /dev/null || true; } | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

already=$(gh secret list --repo "$REPO" 2> /dev/null | awk '{print $1}')
missing=""
for name in $NAMES; do
  v=$(value_in "$name" "$tmp")
  [ -z "$v" ] && [ -f "$LOCAL" ] && v=$(value_in "$name" "$LOCAL")
  if [ -n "$v" ]; then
    printf '%s' "$v" | gh secret set "$name" --repo "$REPO" > /dev/null && echo "set    $name"
  elif grep -qx "$name" <<< "$already"; then
    echo "kept   $name (already in GitHub)"
  elif grep -qw "$name" <<< "$NEEDED"; then
    echo "MISSING $name"
    missing="$missing $name"
  else
    echo "skip   $name (optional, not set)"
  fi
done

provider=$(value_in MAIL_PROVIDER "$tmp")
gh variable set MAIL_PROVIDER --repo "$REPO" --body "${provider:-off}" > /dev/null && echo "set    MAIL_PROVIDER variable: ${provider:-off}"

if [ -n "$missing" ]; then
  echo
  echo "Still to paste by hand (each asks for the value; nothing is shown):"
  for name in $missing; do echo "  gh secret set $name --repo $REPO"; done
  echo "DATABASE_URL is the pooled connection string from Neon (Open in Neon > Connect); keys are in $LOCAL."
  exit 1
fi
echo
echo "Done. Check with a dry run: gh workflow run alerts.yml --repo $REPO -f task=digest -f dry_run=true"
