#!/usr/bin/env bash
# Public Ledger alpha: one-time setup on Vercel. Run it yourself, from the
# repository root, after the two steps in docs/ALPHA.md (a Neon database in
# London, and the Vercel project imported from GitHub with root apps/web).
#
# It generates every key and password on this machine, stores them as Vercel
# environment variables (production), keeps a copy in .env.alpha.local
# (git-ignored, readable only by you), deploys, and prints the URL.
set -euo pipefail
cd "$(dirname "$0")/.."

VERCEL="npx -y vercel@latest"
PROJECT="${VERCEL_PROJECT:-public-ledger}"
SECRETS=".env.alpha.local"
rand() { openssl rand -base64 "$1" | tr -d '\n'; }
word() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

command -v openssl >/dev/null || { echo "openssl is needed (it ships with macOS)."; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) is needed."; exit 1; }

echo "1/5  Signing in to Vercel (a browser window opens if you are not signed in)"
$VERCEL whoami >/dev/null 2>&1 || $VERCEL login

echo "2/5  Linking this repository to the Vercel project \"$PROJECT\""
$VERCEL link --yes --project "$PROJECT"

echo "3/5  Settings"
read -r -p "     Site address [https://$PROJECT.vercel.app]: " SITE_URL
SITE_URL="${SITE_URL:-https://$PROJECT.vercel.app}"
read -r -s -p "     Neon connection string (pooled, starts with postgres://; input hidden): " DATABASE_URL; echo
case "$DATABASE_URL" in postgres://*|postgresql://*) ;; *) echo "     That does not look like a Postgres connection string."; exit 1 ;; esac
read -r -s -p "     Anthropic API key for submission pre-fill (optional, Enter to skip; input hidden): " ANTHROPIC_API_KEY; echo

if [ -f "$SECRETS" ]; then
  echo "     Reusing the keys in $SECRETS (delete it to make new ones)."
  # shellcheck disable=SC1090
  . "$SECRETS"
else
  LEDGER_ENCRYPTION_KEY="$(rand 32)"; LEDGER_LOOKUP_PEPPER="$(rand 32)"; ALTCHA_HMAC_KEY="$(rand 32)"
  ADMIN_USER="editor"; ADMIN_PASSWORD="$(word 24)"
  umask 077
  cat > "$SECRETS" <<SECRETS_EOF
# Public Ledger alpha secrets ($(date "+%Y-%m-%d")). Keep a copy in your password manager.
LEDGER_ENCRYPTION_KEY='$LEDGER_ENCRYPTION_KEY'
LEDGER_LOOKUP_PEPPER='$LEDGER_LOOKUP_PEPPER'
ALTCHA_HMAC_KEY='$ALTCHA_HMAC_KEY'
ADMIN_USER='$ADMIN_USER'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
SECRETS_EOF
fi

echo "4/5  Saving settings in Vercel (production)"
setenv() {
  $VERCEL env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | $VERCEL env add "$1" production >/dev/null
  echo "     $1"
}
setenv LEDGER_ENV production
setenv SITE_STAGE alpha
setenv SITE_URL "$SITE_URL"
setenv MAIL_PROVIDER off
setenv GITHUB_REPOSITORY xternal/public-ledger
setenv DATABASE_URL "$DATABASE_URL"
setenv LEDGER_ENCRYPTION_KEY "$LEDGER_ENCRYPTION_KEY"
setenv LEDGER_LOOKUP_PEPPER "$LEDGER_LOOKUP_PEPPER"
setenv ALTCHA_HMAC_KEY "$ALTCHA_HMAC_KEY"
setenv ADMIN_USER "$ADMIN_USER"
setenv ADMIN_PASSWORD "$ADMIN_PASSWORD"
[ -n "$ANTHROPIC_API_KEY" ] && setenv ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"

echo "5/5  Deploying (a few minutes)"
$VERCEL deploy --prod --yes >/dev/null

echo
echo "Done. Public Ledger alpha:"
echo "  Site:            $SITE_URL"
echo "  Editors' page:   $SITE_URL/admin   user $ADMIN_USER, password in $SECRETS"
echo "  Health check:    $SITE_URL/api/health"
echo
echo "Every merge to main now redeploys the alpha automatically."
