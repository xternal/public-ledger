"""
Forecasts against outturn (M7): python -m etl.backtest

Two steps, both from the committed build, with no network:

1. Record. Every forward number the site shows that a later official outturn
   can score is kept as a Forecast record, append-only, in
   data/build/forecasts/<maker>/<vintage>.json (docs/DATA_MODEL.md "Forecast"):

     obr            OBR forecasts on the Statement's forecast years and the debt
                    path: receipts, total spending, borrowing, debt interest, debt
                    (£bn and % of GDP). Single numbers, as the OBR publishes them.
     public_ledger  Our split of spending by function for the forecast years: each
                    function keeps its share of the latest HMT PESA outturn year.
                    Single numbers, quality approx. Our own forecasts.
     ons            ONS births and deaths on /people (years to 30 June), with the
                    shaded range the page shows: lowest to highest published variant.

   Earlier official forecasts for periods the site already shows as outturn are
   recorded once as "context" (the OBR's March 2026 forecast for 2025-26, the
   ONS projection for the year to mid-2025), so the backtest has something to
   score from day one. They are the OBR's and the ONS's, never ours.

   Left out on purpose (docs/MODEL.md "Backtest"): promise-card costs and
   sandbox or share-page results. They are costings of what-ifs, and no outturn
   measures a what-if.

2. Score. Each record whose period now has an outturn is compared with it in
   data/build/backtest.json: a hit when the outturn is inside the range,
   otherwise a miss above or below, with the size of the miss. Outturn comes from
   ONS public sector finances first, then the OBR's outturn; spending by function
   from HMT PESA outturn; births and deaths from the ONS mid-year estimates. The
   table is worked out again on every run, so revised outturn shows up.

The nightly data job runs this after the build, and CI checks the committed
files are what it produces. The files change only when a new edition brings new
forecasts or new outturn, so most nights there is nothing to commit.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from etl.assemble import pesa_lines
from etl.build import Store
from etl.checks import vintage_date
from etl.core import BUILD_DIR, Observation, write_json
from etl.statement_lines import SPENDING_LINES

log = logging.getLogger(__name__)

FORECASTS_DIR = BUILD_DIR / "forecasts"
BACKTEST_PATH = BUILD_DIR / "backtest.json"

# OBR fiscal aggregates the site shows for forecast years, with the outturn that scores them.
# The 13 receipt lines are left out: OBR and ONS draw some lines differently (business rates,
# non-tax income), so a gap would be a difference of definition, not of forecast.
OBR_SERIES = ["receipts.total", "spending.tme", "fiscal.psnb", "spending.debt_interest", "fiscal.psnd", "fiscal.psnd_pct_gdp"]
FISCAL_OUTTURN = ["ons_psf", "obr_databank", "obr_efo"]  # ONS public sector finances first, then OBR outturn
PEOPLE_SERIES = {"births": "people.births", "deaths": "people.deaths"}
PEOPLE_OUTTURN = ["ons_mye_components"]
# Our own forecasts: the Statement's spending lines for forecast years, split by function.
FUNCTION_LINES = [line_id for line_id, *_ in SPENDING_LINES]
FUNCTION_SERIES = "statement.spending."

ABOUT = {
    "obr": "OBR forecasts as the Statement and the debt path show them. The OBR publishes single numbers in these tables, with no range.",
    "ons": (
        "ONS population projections as /people shows them. The range runs from the lowest to the highest published variant in the shaded "
        "band (special cases left out); variants are other assumptions, not a probability range."
    ),
    "public_ledger": (
        "Our split of spending by function for years with no published split: each function keeps its share of the latest HMT PESA outturn "
        "year, applied to the OBR's total spending less debt interest and accounting adjustments. A single number, quality approx."
    ),
}
CONTEXT_NOTE = {
    "obr": "Recorded after the year ended, to give the backtest an earlier official forecast to score. The site did not show it as a forecast.",
    "ons": (
        "The ONS principal projection, recorded after the year ended to give the backtest an earlier official forecast to score. In a "
        "projection's first year every variant gives nearly the same number, so no range is recorded."
    ),
}


@dataclass(frozen=True)
class Candidate:
    """A forecast the site shows (or an earlier one kept for context), before it is recorded."""

    maker: str
    source_id: str
    vintage: str
    made_on: str
    series_id: str
    period: str
    unit: str
    predicted: tuple[float, float, float]
    recorded_as: str  # shown | context
    quality: str = "sourced"
    note: str | None = None
    inputs: tuple[str, ...] = ()

    @property
    def id(self) -> str:
        return f"{self.maker}:{self.vintage}:{self.series_id}:{self.period}"


# ------------------------------------------------------------------ inputs


def _json(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def _r(x: float) -> float:
    return round(float(x), 3)


def published_on(source_id: str, vintage: str, manifest: dict) -> str:
    """When the publisher released an edition: the manifest's date for the current edition, else the date in its label."""
    for s in manifest.get("sources", []):
        if s["id"] == source_id:
            f = s.get("freshness") or {}
            if f.get("vintage") == vintage and f.get("published_on"):
                return f["published_on"]
    d = vintage_date(vintage)
    if d is None:
        raise ValueError(f"cannot date {source_id} edition {vintage!r}")
    return d.isoformat()


def file_name(vintage: str) -> str:
    """An edition label as a file name: 'EFO-2026-03+PESA-2026' -> 'EFO-2026-03_PESA-2026'."""
    return re.sub(r"[^A-Za-z0-9.-]+", "_", vintage).strip("_")


def _by_vintage(rows: list[Observation]) -> dict[str, list[Observation]]:
    out: dict[str, list[Observation]] = {}
    for o in rows:
        out.setdefault(o.vintage, []).append(o)
    return out


# ------------------------------------------------------------------ what the site shows


def obr_candidates(efo: list[Observation], index: dict, statements: dict[str, dict], manifest: dict) -> list[Candidate]:
    """OBR fiscal forecasts: shown when the Statement shows that year from that edition, else context."""
    out: list[Candidate] = []
    for vintage, rows in sorted(_by_vintage(efo).items()):
        shown = {y["period"] for y in index.get("years", []) if y["kind"] != "outturn" and statements.get(y["period"], {}).get("meta", {}).get("vintage") == vintage}
        made_on = published_on("obr_efo", vintage, manifest)
        for o in sorted(rows, key=lambda o: (o.series_id, o.period)):
            if o.kind != "forecast" or o.series_id not in OBR_SERIES:
                continue
            as_ = "shown" if o.period in shown else "context"
            out.append(Candidate("obr", "obr_efo", vintage, made_on, o.series_id, o.period, o.unit, (_r(o.value),) * 3, as_,
                                 note=CONTEXT_NOTE["obr"] if as_ == "context" else None))
    return out


def ons_candidates(npp: list[Observation], people: dict, manifest: dict) -> list[Candidate]:
    """ONS births and deaths: the range /people shows for its years; the principal projection, as context, for earlier ones."""
    out: list[Candidate] = []
    projection = people.get("projection", {})
    for vintage, rows in sorted(_by_vintage(npp).items()):
        made_on = published_on("ons_npp", vintage, manifest)
        ppp = {(o.series_id, o.period): o for o in rows}
        for measure, series in PEOPLE_SERIES.items():
            chart = people.get("charts", {}).get(measure, {}) if projection.get("vintage") == vintage else {}
            years = [str(y) for y in chart.get("years", [])]
            principal = sorted((o for (s, _), o in ppp.items() if s == f"people.npp.ppp.{measure}"), key=lambda o: o.period)
            first_shown = years[0] if years else None
            for o in principal:
                if o.period in years:
                    lo, c, hi = chart["range"][years.index(o.period)]
                    out.append(Candidate("ons", "ons_npp", vintage, made_on, series, o.period, o.unit, (_r(lo), _r(c), _r(hi)), "shown"))
                elif first_shown is None or o.period < first_shown:
                    # Before the years /people projects: the page shows ONS estimates there, so this is context.
                    out.append(Candidate("ons", "ons_npp", vintage, made_on, series, o.period, o.unit, (_r(o.value),) * 3, "context", note=CONTEXT_NOTE["ons"]))
    return out


def own_candidates(index: dict, statements: dict[str, dict], manifest: dict, today: date) -> list[Candidate]:
    """Our split of spending by function for forecast years (the scaled lines, quality approx)."""
    pesa = next((s.get("freshness", {}).get("vintage") for s in manifest.get("sources", []) if s["id"] == "hmt_pesa"), None)
    out: list[Candidate] = []
    for y in index.get("years", []):
        if y["kind"] == "outturn":
            continue
        s = statements.get(y["period"], {})
        base = s.get("meta", {}).get("vintage")
        if not base or not pesa:
            continue
        vintage = f"{base}+{pesa}"
        for line in s.get("spending", []):
            if line["id"] in FUNCTION_LINES and line["quality"] == "approx":
                out.append(Candidate("public_ledger", "public_ledger", vintage, today.isoformat(), f"{FUNCTION_SERIES}{line['id']}", y["period"], "gbp_bn",
                                     (_r(line["bn"]),) * 3, "shown", quality="approx", inputs=(f"obr_efo:{base}", f"hmt_pesa:{pesa}")))
    return out


def candidates(today: date, build: Path = BUILD_DIR) -> list[Candidate]:
    index = _json(build / "statements" / "index.json")
    statements = {y["period"]: _json(build / "statements" / f"{y['period']}.json") for y in index.get("years", [])}
    manifest = _json(build / "manifest.json")
    people = _json(build / "people.json")
    obs = build / "observations"
    return [
        *obr_candidates(read_committed_in(obs, "obr_efo"), index, statements, manifest),
        *own_candidates(index, statements, manifest, today),
        *ons_candidates(read_committed_in(obs, "ons_npp"), people, manifest),
    ]


def read_committed_in(obs_dir: Path, source_id: str) -> list[Observation]:
    """Every committed edition of a source under `obs_dir` (data/build/observations, or a test copy)."""
    out: list[Observation] = []
    for f in sorted((obs_dir / source_id).glob("*.csv")):
        with f.open() as fh:
            for row in csv.DictReader(fh):
                row = {k: (v if v != "" else None) for k, v in row.items()}
                row["value"] = float(row["value"])
                out.append(Observation(**row))
    return out


# ------------------------------------------------------------------ record (append-only)


def record(today: date, build: Path = BUILD_DIR) -> tuple[int, list[str]]:
    """Append every candidate not yet recorded. Returns (records added, warnings). Recorded forecasts are never changed."""
    folder = build / "forecasts"
    added = 0
    warnings: list[str] = []
    groups: dict[tuple[str, str], list[Candidate]] = {}
    for c in candidates(today, build):
        groups.setdefault((c.maker, c.vintage), []).append(c)
    for (maker, vintage), cands in sorted(groups.items()):
        path = folder / maker / f"{file_name(vintage)}.json"
        existing = _json(path)
        records = list(existing.get("forecasts", []))
        by_id = {r["id"]: r for r in records}
        fresh = []
        for c in cands:
            was = by_id.get(c.id)
            if was is None:
                fresh.append(c)
            elif was["predicted"] != list(c.predicted):
                warnings.append(f"{c.id}: the site now shows {list(c.predicted)}, recorded {was['predicted']} on {was['recorded_on']}; kept as recorded (append-only)")
        if not fresh:
            continue
        first = cands[0]
        data = existing or {
            "maker": maker,
            "source_id": first.source_id,
            "vintage": vintage,
            "made_on": first.made_on,
            **({"inputs": list(first.inputs)} if first.inputs else {}),
            "about": ABOUT[maker],
        }
        for c in fresh:
            records.append({
                "id": c.id,
                "series_id": c.series_id,
                "period": c.period,
                "unit": c.unit,
                "predicted": list(c.predicted),
                "range": "range" if c.predicted[0] < c.predicted[2] else "point",
                "quality": c.quality,
                "recorded_on": today.isoformat(),
                "recorded_as": c.recorded_as,
                **({"note": c.note} if c.note else {}),
            })
        data["forecasts"] = records
        write_json(path, data)
        added += len(fresh)
    return added, warnings


def load_records(build: Path = BUILD_DIR) -> list[dict]:
    """Every recorded forecast, flattened with its file's maker, source, edition and date."""
    out = []
    for path in sorted((build / "forecasts").glob("*/*.json")):
        f = json.loads(path.read_text())
        for r in f["forecasts"]:
            out.append({**r, "maker": f["maker"], "source_id": f["source_id"], "vintage": f["vintage"], "made_on": f["made_on"]})
    return out


# ------------------------------------------------------------------ score


def outturn_store(obs_dir: Path) -> Store:
    """Latest edition of every outturn observation, per source. Forecast rows are left out, so a later edition's outturn wins."""
    sources = {*FISCAL_OUTTURN, *PEOPLE_OUTTURN, "hmt_pesa"}
    return Store({sid: [o for o in read_committed_in(obs_dir, sid) if o.kind == "outturn"] for sid in sources})


@dataclass(frozen=True)
class Outturn:
    value: float
    source_id: str
    vintage: str
    quality: str


def find_outturn(store: Store, series_id: str, period: str) -> Outturn | None:
    if series_id.startswith(FUNCTION_SERIES):
        got = pesa_lines(store, period)
        if not got:
            return None
        vals, vintage, kind = got
        line = series_id.removeprefix(FUNCTION_SERIES)
        return Outturn(vals[line], "hmt_pesa", vintage, "sourced") if kind == "outturn" and line in vals else None
    prefer = PEOPLE_OUTTURN if series_id in PEOPLE_SERIES.values() else FISCAL_OUTTURN
    o = store.get(series_id, period, prefer)
    return Outturn(o.value, o.source_id, o.vintage, o.quality) if o else None


def score_one(predicted: list[float], outturn: float) -> dict:
    """Hit when low <= outturn <= high; otherwise a miss above or below, sized from the nearer edge of the range."""
    lo, c, hi = (round(x, 3) for x in predicted)
    out = round(outturn, 3)
    if out > hi:
        result, miss = "miss_above", out - hi
    elif out < lo:
        result, miss = "miss_below", lo - out
    else:
        result, miss = "hit", 0.0
    pct = (lambda x: round(x / abs(c) * 100, 2)) if c else (lambda x: None)
    return {"result": result, "miss": round(miss, 3), "miss_pct": pct(miss), "error": round(out - c, 3), "error_pct": pct(out - c)}


def score(build: Path = BUILD_DIR) -> dict:
    store = outturn_store(build / "observations")
    results = []
    used: set[tuple[str, str]] = set()
    for r in load_records(build):
        o = find_outturn(store, r["series_id"], r["period"])
        if o is None:
            continue
        used.add((o.source_id, o.vintage))
        results.append({"forecast_id": r["id"], "outturn": round(o.value, 3), "outturn_source_id": o.source_id, "outturn_vintage": o.vintage,
                        "outturn_quality": o.quality, **score_one(r["predicted"], o.value)})
    results.sort(key=lambda x: x["forecast_id"])
    return {"outturn_editions": [{"source_id": s, "vintage": v} for s, v in sorted(used)], "results": results}


# ------------------------------------------------------------------ main


def run(today: date | None = None, build: Path = BUILD_DIR) -> int:
    today = today or date.today()
    added, warnings = record(today, build)
    for w in warnings:
        log.warning("forecasts: %s", w)
    table = score(build)
    write_json(build / "backtest.json", table)
    n = len(load_records(build))
    hits = sum(1 for r in table["results"] if r["result"] == "hit")
    log.info("forecasts: %d recorded (%d new); backtest: %d scored, %d hit(s), %d waiting for outturn", n, added, len(table["results"]), hits, n - len(table["results"]))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--today", type=date.fromisoformat, help="date for new records (tests)")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return run(args.today)


if __name__ == "__main__":
    sys.exit(main())
