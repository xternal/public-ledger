"""Markdown summary of a build for the nightly pull request body: what changed and what to check."""

from __future__ import annotations

import json
import subprocess

from etl.core import BUILD_DIR, ROOT


def changed_files() -> list[str]:
    out = subprocess.run(["git", "diff", "--cached", "--name-only", "HEAD~1", "--", "data/build"], cwd=ROOT, capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l]


def main() -> None:
    m = json.loads((BUILD_DIR / "manifest.json").read_text())
    lines = [f"Nightly data refresh, build `{m['build_id']}` (status **{m['status']}**).", ""]
    files = changed_files()
    new_vintages = [f for f in files if f.startswith("data/build/observations/")]
    if new_vintages:
        lines += ["**New or revised editions**", *[f"- `{f}`" for f in new_vintages], ""]
    lines += ["**Sources**", "", "| Source | Edition | Age (days) | Overdue |", "|---|---|---|---|"]
    for s in m["sources"]:
        f = s.get("freshness") or {}
        lines.append(f"| {s['title']} | {f.get('vintage', '')} | {f.get('age_days', '')} | {f.get('overdue_days', '')} |")
    if m["checks"]:
        lines += ["", "**Checks**", *[f"- {c['level']}: {c['check_id']} {c['subject']}: {c['message']}" for c in m["checks"]]]
    lines += ["", "Review the Statement diffs in `data/build/statements/` before merging. Nothing merges without a human review."]
    print("\n".join(lines))


if __name__ == "__main__":
    main()
