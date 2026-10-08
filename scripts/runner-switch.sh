#!/usr/bin/env bash
# Choose where the repository's GitHub Actions jobs run. Every workflow says
# `runs-on: ${{ vars.RUNS_ON || 'ubuntu-latest' }}`, so one repository variable decides:
#
#   scripts/runner-switch.sh mac      jobs run on the Mac set up by scripts/runner-setup.sh
#   scripts/runner-switch.sh github   jobs run on GitHub's machines (the default; uses the Actions budget)
#   scripts/runner-switch.sh status   show where jobs run and whether the Mac runner is online
set -euo pipefail

REPO="${REPO:-xternal/public-ledger}"
LABEL="ledger-mac"

runners() { gh api "repos/$REPO/actions/runners" --jq ".runners[] | select([.labels[].name] | index(\"$LABEL\")) | \"\(.name): \(.status)\(if .busy then \", busy\" else \"\" end)\""; }
current() { gh variable get RUNS_ON --repo "$REPO" 2> /dev/null || echo "ubuntu-latest (GitHub's machines)"; }

case "${1:-status}" in
  mac)
    online=$(runners | grep -c ": online" || true)
    [ "$online" -gt 0 ] || { echo "No online Mac runner with the label $LABEL. Run scripts/runner-setup.sh first, and keep the Mac awake." >&2; exit 1; }
    gh variable set RUNS_ON --repo "$REPO" --body "$LABEL"
    echo "Jobs now run on this Mac ($LABEL). Jobs already queued for GitHub's machines stay there."
    ;;
  github)
    gh variable delete RUNS_ON --repo "$REPO" 2> /dev/null || true
    echo "Jobs now run on GitHub's machines."
    ;;
  status)
    echo "Jobs run on: $(current)"
    echo "Mac runners:"
    runners | sed 's/^/  /' || true
    ;;
  *)
    echo "usage: $0 mac | github | status" >&2
    exit 2
    ;;
esac
