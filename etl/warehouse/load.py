"""
Build the analytics warehouse (data/warehouse/ledger.duckdb, gitignored) from
the committed build output and run log.

    python -m etl.warehouse.load            rebuild the DuckDB file
    python -m etl.warehouse.load --report   print the quality and quantity questions

The schema and the questions it answers are in etl/warehouse/schema.sql and
docs/ANALYTICS_DB.md. Content tables fill from M3, usage from when a sink exists.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

import duckdb

from etl.core import BUILD_DIR, ROOT

DB_PATH = ROOT / "data" / "warehouse" / "ledger.duckdb"
SCHEMA = Path(__file__).with_name("schema.sql")
HISTORY = BUILD_DIR / "history"


def period_meta(period: str) -> tuple[str, str]:
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", period):
        return "date", period
    if re.fullmatch(r"\d{4}-\d{2}", period):
        start, end = int(period[:4]), int(period[5:])
        if (start + 1) % 100 == end:
            return "fiscal_year", f"{start}-04-01"
        return "month", f"{period}-01"
    if re.fullmatch(r"\d{4}", period):
        return "year", f"{period}-01-01"
    return "other", "1900-01-01"


def domain_of(series_id: str) -> str:
    return series_id.split(".", 1)[0]


def load(db_path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    con = duckdb.connect(str(db_path))
    con.execute(SCHEMA.read_text())

    for name, table in [("runs.csv", "etl_run"), ("artifacts.csv", "etl_artifact"), ("checks.csv", "etl_check")]:
        f = HISTORY / name
        if f.exists():
            con.execute(f"INSERT INTO {table} SELECT * FROM read_csv_auto(?, header=true, all_varchar=false)", [str(f)])

    manifest = json.loads((BUILD_DIR / "manifest.json").read_text())
    for s in manifest["sources"]:
        con.execute(
            "INSERT INTO dim_source VALUES (?, ?, ?, ?, ?, ?, ?)",
            [s["id"], s["title"], s["publisher"], s["url"], s.get("licence"), s["cadence_days"], s["grace_days"]],
        )

    first_seen = _first_seen_builds()
    series: dict[str, str] = {}
    rows = []
    for f in sorted((BUILD_DIR / "observations").glob("*/*.csv")):
        with f.open() as fh:
            for r in csv.DictReader(fh):
                ptype, pstart = period_meta(r["period"])
                series.setdefault(r["series_id"], r["unit"])
                rows.append((
                    r["series_id"], r["period"], ptype, pstart, r["geography"], float(r["value"]), r["unit"], r["kind"],
                    r["source_id"], r["vintage"], r["quality"], r["method_note"] or None,
                    first_seen.get((r["source_id"], r["vintage"]), manifest["build_id"]),
                ))
    con.executemany("INSERT INTO fact_observation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.executemany("INSERT INTO dim_series VALUES (?, ?, NULL, ?)", [(sid, domain_of(sid), unit) for sid, unit in series.items()])

    lines = []
    for f in sorted((BUILD_DIR / "statements").glob("*.json")):
        if f.name == "index.json":
            continue
        s = json.loads(f.read_text())
        kind = s["meta"].get("kind", "forecast")
        for side, key in [("receipt", "receipts"), ("spending", "spending")]:
            for l in s[key]:
                lines.append((manifest["build_id"], s["meta"]["fiscal_year"], kind, side, l["id"], l["bn"], l["quality"], bool(l.get("plug")), l.get("source_id")))
        bp = s["borrowing_provenance"]
        lines.append((manifest["build_id"], s["meta"]["fiscal_year"], kind, "financing", "borrowing", s["borrowing_bn"], bp["quality"], False, bp.get("source_id")))
    con.executemany("INSERT INTO fact_statement_line VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", lines)
    return con


def _first_seen_builds() -> dict[tuple[str, str], str]:
    """The first build that saw each (source, vintage), from the artifact log."""
    f = HISTORY / "artifacts.csv"
    out: dict[tuple[str, str], str] = {}
    if f.exists():
        with f.open() as fh:
            for r in csv.DictReader(fh):
                out.setdefault((r["source_id"], r["vintage"]), r["build_id"])
    return out


def report(con: duckdb.DuckDBPyConnection) -> None:
    def show(title: str, sql: str) -> None:
        print(f"\n== {title}")
        print(con.sql(sql))

    show("Quantity: data held", "SELECT * FROM v_data_volume")
    show("Quality: Statement by provenance (receipts side, latest build)",
         "SELECT period, kind, round(total_bn,1) AS total_bn, round(share_sourced*100,1) AS pct_sourced, round(share_estimate*100,1) AS pct_estimate, round(share_plug*100,1) AS pct_plug FROM v_statement_quality")
    show("Quality: source freshness", "SELECT * FROM v_source_freshness")
    show("Quality: checks per build", "SELECT * FROM v_check_trend WHERE level IS NOT NULL")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    con = load()
    print(f"wrote {DB_PATH.relative_to(ROOT)}")
    if args.report:
        report(con)


if __name__ == "__main__":
    main()
