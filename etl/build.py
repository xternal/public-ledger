"""
Run every source, normalise, check and write data/build/ (docs/BUILD_PLAN.md M1).

    python -m etl.build             fetch (cached 20 h) + parse + assemble + check
    python -m etl.build --offline   rebuild from committed observations only
    python -m etl.build --only a,b  fetch sources a and b; rebuild the rest from committed observations

Outputs (all committed, so every data change is a reviewable diff):
    data/build/observations/<source>/<vintage>.csv   every observation, one file per edition (not for an
                                                     edition that only relabels the newest committed one)
    data/build/statements/<year>.json + index.json   what the Statement shows for each year
    data/build/levers.json, tax.json                 sandbox coefficients and Your share rates
    data/build/people.json                           population and long-term spending projections (/people)
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

# Sources whose publisher refuses GitHub's servers. They read through the Internet Archive
# (etl/wayback.py); when that fails too, a person refreshes them from a normal connection.
_BY_HAND = ("OBR refuses GitHub's servers, so if the Internet Archive cannot supply the new edition either, run "
            "`pnpm etl` on your own machine and open the data pull request from there (docs/OPERATIONS.md, \"11. OBR data by hand\")")
MANUAL_REFRESH = {"obr_databank": _BY_HAND, "obr_efo": _BY_HAND}


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


def edition_rank(vintage: str) -> tuple[str, str]:
    """Order of editions: by the date in the label (publication date), the label breaking ties."""
    from etl.checks import vintage_date

    d = vintage_date(vintage)
    return (d.isoformat() if d else "", vintage)


def _key(o: Observation) -> tuple[str, str, str]:
    return (o.series_id, o.period, o.geography)


def _content(rows: list[Observation]) -> list[tuple]:
    """Rows as written to disk, without the edition label."""
    return sorted((*_key(o), round(o.value, 6), o.unit, o.kind, o.source_id, o.quality, o.method_note or "") for o in rows)


def repeated_edition(vintage: str, rows: list[Observation], committed: list[Observation]) -> str | None:
    """
    The committed edition that a new edition repeats number for number under another label, or None.

    A label can move while the data stays: a publisher republishes a page for technical reasons
    (GOV.UK's updated_at), or a module dates its edition by the day it fetched. Writing such an
    edition adds a file with the same numbers and opens a data pull request for nothing. Only the
    newest committed edition holding the same rows counts, so data that goes back to an older
    edition's numbers is still written; an edition already on disk is rewritten in place, so a
    revision under the same label shows as a diff.
    """
    if any(o.vintage == vintage for o in committed):
        return None
    keys = {_key(o) for o in rows}
    holding = {o.vintage for o in committed if _key(o) in keys}
    if not holding:
        return None
    newest = max(holding, key=edition_rank)
    return newest if _content([o for o in committed if o.vintage == newest]) == _content(rows) else None


def write_observations(source_id: str, obs: list[Observation]) -> dict[str, str]:
    """Write each edition to its own file, except one that repeats a committed edition: {new label: label kept}."""
    by_vintage: dict[str, list[Observation]] = defaultdict(list)
    for o in obs:
        by_vintage[o.vintage].append(o)
    committed = read_committed(source_id)
    kept: dict[str, str] = {}
    for vintage, rows in by_vintage.items():
        if same := repeated_edition(vintage, rows, committed):
            kept[vintage] = same
            continue
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
    return kept


def manifest_sources() -> dict[str, dict]:
    """Source metadata recorded by the last online build (edition titles and dates found while fetching)."""
    path = BUILD_DIR / "manifest.json"
    if not path.exists():
        return {}
    return {s["id"]: s for s in json.loads(path.read_text()).get("sources", [])}


# What a module learns about its edition while fetching. The rest (cadence, grace, licence) stays as the
# module declares it, so a change there applies to the next offline rebuild too, not after the next online one.
FETCHED_FIELDS = ("title", "url", "published_on")


def recorded_source(src: Source, recorded: dict[str, dict]) -> Source:
    """The source with the edition title, URL and publication date the last online build recorded, else as declared."""
    if src.id not in recorded:
        return src
    return Source(**{**src.model_dump(), **{k: recorded[src.id][k] for k in FETCHED_FIELDS if k in recorded[src.id]}})


def collect(run: Run, offline: bool, only: set[str] | None = None) -> dict[str, list[Observation]]:
    """Every source's observations: fetched, or (offline, or not among `only`) the committed editions."""
    by_source: dict[str, list[Observation]] = {}
    recorded = manifest_sources()
    for mod in discover():
        src: Source = mod.SOURCE
        committed_only = offline or (only is not None and src.id not in only)
        if committed_only:
            # Modules learn the edition's title and date while fetching; offline, take them from the manifest.
            src = recorded_source(src, recorded)
        run.sources[src.id] = src
        if committed_only:
            by_source[src.id] = read_committed(src.id)
            continue
        try:
            raws = mod.fetch(None)
            raws = raws if isinstance(raws, list) else [raws]
            obs = mod.parse(raws)
            run.artifacts.extend(raws)
            for new, same in write_observations(src.id, obs).items():
                run.add("edition", "info", src.id, f"{new} repeats {same} number for number; kept {same}")
            # Build from what is now on disk, as the offline rebuild in CI will: every committed edition, the newest winning.
            by_source[src.id] = read_committed(src.id)
        except Exception as e:  # keep building from the last committed edition
            committed = read_committed(src.id)
            level = "error" if not committed else "warning"
            hint = f". {MANUAL_REFRESH[src.id]}" if src.id in MANUAL_REFRESH else ""
            run.add("fetch", level, src.id, f"{type(e).__name__}: {e}; using {len(committed)} committed observations{hint}")
            traceback.print_exc(file=sys.stderr)
            by_source[src.id] = committed
            # The committed observations come from the recorded edition, so keep its title and date too.
            run.sources[src.id] = recorded_source(mod.SOURCE, recorded)
    return by_source


# ------------------------------------------------------------------ lookups


class Store:
    """Latest vintage of every (series, period, source)."""

    def __init__(self, by_source: dict[str, list[Observation]]):
        self.idx: dict[tuple[str, str, str], Observation] = {}
        for sid, obs in by_source.items():
            for o in obs:
                key = (o.series_id, o.period, sid)
                cur = self.idx.get(key)
                # Newest edition by publication date; the label breaks ties.
                if cur is None or edition_rank(o.vintage) > edition_rank(cur.vintage):
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
    ap.add_argument("--only", help="comma-separated source ids to fetch; every other source is rebuilt from its committed editions")
    args = ap.parse_args(argv)
    import logging

    # Source modules log which edition they picked at INFO; show it in every run.
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s: %(message)s")
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    now = datetime.now(timezone.utc)
    trigger = "offline" if args.offline and args.trigger == "manual" else args.trigger
    run = Run(build_id=now.strftime("%Y-%m-%dT%H:%M:%SZ"), started_at=now.isoformat(timespec="seconds"), trigger=trigger)

    only = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None
    by_source = collect(run, args.offline, only)
    store = Store(by_source)

    # Import the assembly steps that depend on source details lazily, so a missing
    # source fails one check instead of the whole run.
    from etl.assemble import assemble_all

    outputs = assemble_all(store, run)
    from etl.people import assemble_people

    outputs["people"] = assemble_people(store, run, outputs.get("sources", []))
    from etl.checks import run_checks

    run_checks(store, run, outputs)
    from etl.publish import publish

    return publish(run, store, by_source, outputs, git_sha())


if __name__ == "__main__":
    sys.exit(main())
