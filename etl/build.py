"""
Run every source, normalise, check and write data/build/ (docs/BUILD_PLAN.md M1).

    python -m etl.build             fetch (cached 20 h) + parse + assemble + check
    python -m etl.build --offline   rebuild from committed observations only

Outputs (all committed, so every data change is a reviewable diff):
    data/build/observations/<source>/<vintage>.csv   every observation, one file per edition
    data/build/statements/<year>.json + index.json   what the Statement shows for each year
    data/build/levers.json, tax.json                 sandbox coefficients and Your share rates
    data/build/manifest.json                         sources, files, hashes, vintages, freshness, checks
    data/build/history/{runs,artifacts,checks}.csv   append-only pipeline log for the warehouse

Exit status is non-zero when any check is an error (balance, coverage, staleness).
"""

from __future__ import annotations

import argparse
import csv
import importlib
import json
import math
import pkgutil
import subprocess
import sys
import traceback
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from etl import sources as sources_pkg
from etl.core import BUILD_DIR, ROOT, Observation, RawArtifact, Source, write_json

OBS_DIR = BUILD_DIR / "observations"
HISTORY_DIR = BUILD_DIR / "history"
SEED_DIR = ROOT / "data" / "seed"
OBS_FIELDS = ["series_id", "period", "geography", "value", "unit", "kind", "source_id", "vintage", "quality", "method_note"]


@dataclass
class Check:
    check_id: str
    level: str  # error | warning | info
    subject: str
    message: str
    value: float | None = None


@dataclass
class Run:
    build_id: str
    started_at: str
    trigger: str
    checks: list[Check] = field(default_factory=list)
    artifacts: list[RawArtifact] = field(default_factory=list)
    sources: dict[str, Source] = field(default_factory=dict)

    def add(self, check_id: str, level: str, subject: str, message: str, value: float | None = None) -> None:
        self.checks.append(Check(check_id, level, subject, message, value))


# ------------------------------------------------------------------ sources


def discover() -> list:
    mods = []
    for info in pkgutil.iter_modules(sources_pkg.__path__):
        mod = importlib.import_module(f"etl.sources.{info.name}")
        if all(hasattr(mod, a) for a in ("SOURCE", "fetch", "parse")):
            mods.append(mod)
    return sorted(mods, key=lambda m: m.SOURCE.id)


def read_committed(source_id: str) -> list[Observation]:
    """Observations already in data/build for a source (all vintages)."""
    out: list[Observation] = []
    for f in sorted((OBS_DIR / source_id).glob("*.csv")):
        with f.open() as fh:
            for row in csv.DictReader(fh):
                row = {k: (v if v != "" else None) for k, v in row.items()}
                row["value"] = float(row["value"])
                out.append(Observation(**row))
    return out


def write_observations(source_id: str, obs: list[Observation]) -> None:
    by_vintage: dict[str, list[Observation]] = defaultdict(list)
    for o in obs:
        by_vintage[o.vintage].append(o)
    for vintage, rows in by_vintage.items():
        path = OBS_DIR / source_id / f"{vintage}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = sorted(rows, key=lambda o: (o.series_id, o.period, o.geography))
        with path.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=OBS_FIELDS, lineterminator="\n")
            w.writeheader()
            for o in rows:
                d = o.model_dump()
                d["value"] = repr(round(o.value, 6))
                w.writerow({k: ("" if d[k] is None else d[k]) for k in OBS_FIELDS})


def collect(run: Run, offline: bool) -> dict[str, list[Observation]]:
    by_source: dict[str, list[Observation]] = {}
    for mod in discover():
        src: Source = mod.SOURCE
        run.sources[src.id] = src
        if offline:
            by_source[src.id] = read_committed(src.id)
            continue
        try:
            raws = mod.fetch(None)
            raws = raws if isinstance(raws, list) else [raws]
            obs = mod.parse(raws)
            run.artifacts.extend(raws)
            write_observations(src.id, obs)
            by_source[src.id] = obs
        except Exception as e:  # keep building from the last committed edition
            committed = read_committed(src.id)
            level = "error" if not committed else "warning"
            run.add("fetch", level, src.id, f"{type(e).__name__}: {e}; using {len(committed)} committed observations")
            traceback.print_exc(file=sys.stderr)
            by_source[src.id] = committed
    return by_source


# ------------------------------------------------------------------ lookups


class Store:
    """Latest vintage of every (series, period, source)."""

    def __init__(self, by_source: dict[str, list[Observation]]):
        from etl.checks import vintage_date

        def rank(o: Observation):
            d = vintage_date(o.vintage)
            return (d.isoformat() if d else "", o.vintage)

        self.idx: dict[tuple[str, str, str], Observation] = {}
        for sid, obs in by_source.items():
            for o in obs:
                key = (o.series_id, o.period, sid)
                cur = self.idx.get(key)
                # Newest edition by publication date; the label breaks ties.
                if cur is None or rank(o) > rank(cur):
                    self.idx[key] = o

    def get(self, series: str, period: str, prefer: list[str]) -> Observation | None:
        for sid in prefer:
            o = self.idx.get((series, period, sid))
            if o is not None:
                return o
        return None

    def periods(self, series: str, source: str) -> list[str]:
        return sorted({p for (s, p, sid) in self.idx if s == series and sid == source})

    def latest(self, series: str, prefer: list[str]) -> Observation | None:
        for sid in prefer:
            ps = self.periods(series, sid)
            if ps:
                return self.idx[(series, ps[-1], sid)]
        return None


def fy_start(fy: str) -> int:
    return int(fy[:4])


def note_of(o: Observation) -> dict:
    d = {"quality": o.quality, "source_id": o.source_id}
    if o.method_note:
        d["method_note"] = o.method_note
    return d


# ------------------------------------------------------------------ main


def git_sha() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--trigger", default="manual")
    args = ap.parse_args(argv)
    import logging

    # Source modules log which edition they picked at INFO; show it in every run.
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s: %(message)s")
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    now = datetime.now(timezone.utc)
    run = Run(build_id=now.strftime("%Y-%m-%dT%H:%M:%SZ"), started_at=now.isoformat(timespec="seconds"), trigger=args.trigger)

    by_source = collect(run, args.offline)
    store = Store(by_source)

    # Import the assembly steps that depend on source details lazily, so a missing
    # source fails one check instead of the whole run.
    from etl.assemble import assemble_all

    outputs = assemble_all(store, run)
    from etl.checks import run_checks

    run_checks(store, run, outputs)
    from etl.publish import publish

    return publish(run, store, by_source, outputs, git_sha())


if __name__ == "__main__":
    sys.exit(main())
