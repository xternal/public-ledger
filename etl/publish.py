"""Write data/build/ and the append-only run log, then report."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone

from etl.build import BUILD_DIR, HISTORY_DIR, Run, Store
from etl.core import ROOT, Observation, write_json

RUN_FIELDS = ["build_id", "started_at", "finished_at", "git_sha", "trigger", "status", "observations", "errors", "warnings"]
ARTIFACT_FIELDS = ["build_id", "source_id", "url", "sha256", "bytes", "fetched_at", "vintage", "changed"]
CHECK_FIELDS = ["build_id", "check_id", "level", "subject", "message", "value"]


def _append(path, fields, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator="\n")
        if new:
            w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fields})


def _previous_hashes() -> dict[str, str]:
    path = HISTORY_DIR / "artifacts.csv"
    if not path.exists():
        return {}
    seen: dict[str, str] = {}
    with path.open() as fh:
        for row in csv.DictReader(fh):
            seen[row["url"]] = row["sha256"]
    return seen


def publish(run: Run, store: Store, by_source: dict[str, list[Observation]], outputs: dict, git_sha: str | None) -> int:
    errors = [c for c in run.checks if c.level == "error"]
    warnings = [c for c in run.checks if c.level == "warning"]
    finished = datetime.now(timezone.utc).isoformat(timespec="seconds")
    status = "failed" if errors else "ok"
    n_obs = sum(len(v) for v in by_source.values())

    if outputs.get("statements") and not errors:
        for year, s in outputs["statements"].items():
            write_json(BUILD_DIR / "statements" / f"{year}.json", s)
        write_json(BUILD_DIR / "statements" / "index.json", {"base_year": outputs["base_year"], "years": outputs["years"]})
        write_json(BUILD_DIR / "levers.json", outputs["levers"])
        write_json(BUILD_DIR / "tax.json", outputs["tax"])
        write_json(
            BUILD_DIR / "app.json",
            {
                "built_at": run.build_id,
                "base_year": outputs["base_year"],
                "years": outputs["years"],
                "statements": outputs["statements"],
                "levers": outputs["levers"],
                "tax": outputs["tax"],
                "sources": outputs["sources"],
            },
        )

    previous = _previous_hashes()
    manifest = {
        "build_id": run.build_id,
        "git_sha": git_sha,
        "status": status,
        "base_year": outputs.get("base_year"),
        "observations": n_obs,
        "sources": [
            {
                **src.model_dump(mode="json"),
                "freshness": outputs.get("freshness", {}).get(sid),
                "observations": len(by_source.get(sid, [])),
                "vintages": sorted({o.vintage for o in by_source.get(sid, [])}),
                "files": [a.to_manifest() for a in run.artifacts if a.source_id == sid],
            }
            for sid, src in sorted(run.sources.items())
        ],
        "checks": [c.__dict__ for c in run.checks if c.level != "info"],
        "identity": [c.__dict__ for c in run.checks if c.check_id == "identity"],
    }
    write_json(BUILD_DIR / "manifest.json", manifest)

    _append(HISTORY_DIR / "runs.csv", RUN_FIELDS, [{
        "build_id": run.build_id, "started_at": run.started_at, "finished_at": finished, "git_sha": git_sha,
        "trigger": run.trigger, "status": status, "observations": n_obs, "errors": len(errors), "warnings": len(warnings),
    }])
    _append(HISTORY_DIR / "artifacts.csv", ARTIFACT_FIELDS, [{
        "build_id": run.build_id, "source_id": a.source_id, "url": a.url, "sha256": a.sha256,
        "bytes": a.path.stat().st_size if a.path.exists() else None, "fetched_at": a.fetched_at,
        "vintage": a.vintage, "changed": previous.get(a.url) not in (None, a.sha256),
    } for a in run.artifacts])
    _append(HISTORY_DIR / "checks.csv", CHECK_FIELDS, [{"build_id": run.build_id, **c.__dict__} for c in run.checks])

    for c in run.checks:
        if c.level != "info":
            print(f"{c.level:7} {c.check_id:10} {c.subject}: {c.message}")
    print(f"\n{status}: {n_obs} observations from {len(run.sources)} sources, {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0
