#!/usr/bin/env bash
# Mac fallback for GitHub Actions: let this Mac run the repository's jobs (a
# "self-hosted runner"), for when GitHub's own machines are unavailable, for
# example when the Actions budget runs out. Jobs on your own machine are free.
#
#   scripts/runner-setup.sh            download, register and start the runner (jobs stay on GitHub until you switch)
#   scripts/runner-setup.sh --remove   stop it, unregister it and delete it
#
# Then switch jobs with scripts/runner-switch.sh mac | github | status.
# Details and caveats: docs/OPERATIONS.md, "Mac fallback for GitHub Actions".
set -euo pipefail

REPO="${REPO:-xternal/public-ledger}"
LABEL="ledger-mac"
DIR="${RUNNER_DIR:-$HOME/actions-runner/public-ledger}"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this script sets up a Mac; on Linux follow GitHub's runner instructions instead"
[ "$(uname -m)" = "arm64" ] || die "this script expects an Apple Silicon Mac (arm64)"
command -v gh > /dev/null || die "the GitHub CLI (gh) is needed: brew install gh, then gh auth login"
gh auth status > /dev/null 2>&1 || die "sign in to GitHub first: gh auth login"

if [ "${1:-}" = "--remove" ]; then
  say "Moving jobs back to GitHub's machines"
  gh variable delete RUNS_ON --repo "$REPO" 2> /dev/null || true
  [ -d "$DIR" ] || die "no runner in $DIR"
  cd "$DIR"
  say "Stopping and unregistering the runner"
  ./svc.sh stop 2> /dev/null || true
  ./svc.sh uninstall 2> /dev/null || true
  ./config.sh remove --token "$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)"
  cd "$HOME" && rm -rf "$DIR"
  say "Removed. Jobs run on GitHub's machines."
  exit 0
fi

# A runner on your own machine runs whatever code a workflow is given. That is
# fine for a private repository only you and invited editors can push to, and
# never fine for a public one, where anyone's pull request could run here.
[ "$(gh repo view "$REPO" --json visibility --jq .visibility)" = "PRIVATE" ] || die "$REPO is not private; a runner on your Mac must never serve a public repository"

if [ -f "$DIR/.runner" ]; then
  say "Already set up in $DIR; making sure it is running"
  cd "$DIR" && (./svc.sh start || true) && ./svc.sh status || true
  exit 0
fi

say "Finding GitHub's latest runner release"
TAG=$(gh api repos/actions/runner/releases/latest --jq .tag_name)
VERSION="${TAG#v}"
FILE="actions-runner-osx-arm64-$VERSION.tar.gz"
URL="https://github.com/actions/runner/releases/download/$TAG/$FILE"
# The release notes carry each file's SHA-256 between markers; the download must match it.
SHA=$(gh api repos/actions/runner/releases/latest --jq .body | sed -n 's/.*<!-- BEGIN SHA osx-arm64 -->\([0-9a-f]\{64\}\)<!-- END SHA osx-arm64 -->.*/\1/p')
[ -n "$SHA" ] || die "could not read the checksum for $FILE from the release notes"
echo "$FILE from github.com/actions/runner ($TAG)"

mkdir -p "$DIR" && cd "$DIR"
say "Downloading $FILE (about 130 MB)"
curl -fL --progress-bar -o "$FILE" "$URL"
echo "$SHA  $FILE" | shasum -a 256 -c - || { rm -f "$FILE"; die "checksum mismatch; the download was deleted"; }
tar xzf "$FILE" && rm -f "$FILE"

say "Registering it with $REPO (label: $LABEL)"
./config.sh --unattended --replace \
  --url "https://github.com/$REPO" \
  --token "$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)" \
  --name "$(scutil --get LocalHostName)-ledger" \
  --labels "$LABEL" \
  --work _work

say "Starting it as a background service (it starts again when you log in)"
./svc.sh install
./svc.sh start

say "Runners registered with $REPO"
gh api "repos/$REPO/actions/runners" --jq '.runners[] | "\(.name): \(.status), labels \([.labels[].name] | join(", "))"'

cat << EOF

Done. Jobs still run on GitHub's machines. To move them to this Mac:
  scripts/runner-switch.sh mac
and back:
  scripts/runner-switch.sh github
Keep the Mac awake while it serves jobs: jobs wait while it sleeps, and GitHub cancels a job that waits 24 hours.
EOF
