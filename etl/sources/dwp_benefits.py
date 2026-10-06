"""
DWP Benefit expenditure and caseload tables ("Outturn and forecast tables").

What we take, from the "State Pension" sheet:

- spending.state_pension            State Pension expenditure, £bn nominal (from £ million)
- people.state_pension_caseload     average State Pension caseload over the year, persons_m (from thousands)

Geography is "GB": DWP figures cover Great Britain plus people resident
overseas who receive UK benefits. Northern Ireland's State Pension is paid by
the NI Executive and is only published inside "Northern Ireland Social
Security" (UK welfare sheet), without a State Pension split, so no UK figure
is emitted here.

Kind follows DWP's own column label: "Outturn" -> outturn, "Forecast" -> forecast.
The forecast is consistent with the OBR EFO named in the edition (e.g. the
Spring Forecast 2026 tables match the March 2026 EFO).
"""

from __future__ import annotations

import json
import re
from datetime import date

import openpyxl

from etl.core import Observation, RawArtifact, Source, download, normalise_fiscal_year

CONTENT_API = "https://www.gov.uk/api/content"
COLLECTION = "/government/collections/benefit-expenditure-and-caseload-tables"

SOURCE = Source(
    id="dwp_benefits",
    title="DWP Benefit expenditure and caseload tables",
    publisher="Department for Work and Pensions",
    url="https://www.gov.uk" + COLLECTION,
    licence="OGL v3",
    published_on=date(2026, 4, 14),  # Spring Forecast 2026 tables; fetch() updates it
    cadence_days=200,  # with each fiscal event (spring and autumn)
    grace_days=60,
)

GEOGRAPHY = "GB"


def _content(path: str, name: str) -> dict:
    raw = download(SOURCE.id, CONTENT_API + path, filename=f"govuk_{name}.json")
    return json.loads(raw.path.read_text())


def _vintage(title: str, fallback_year: str) -> str:
    """'Outturn and forecast tables: Spring Forecast 2026' -> 'DWP-SF-2026'."""
    m = re.search(r":\s*([A-Za-z ]+?)\s+(\d{4})\s*$", title.strip())
    if not m:
        return f"DWP-{fallback_year}"
    initials = "".join(w[0].upper() for w in m.group(1).split())
    return f"DWP-{initials}-{m.group(2)}"


def fetch(since: date | None = None) -> list[RawArtifact]:
    coll = _content(COLLECTION, "dwp_collection")
    best = None
    for doc in coll.get("links", {}).get("documents", []):
        m = re.fullmatch(r"/government/publications/benefit-expenditure-and-caseload-tables-(\d{4})", doc.get("base_path", ""))
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), doc)
    if best is None:
        raise RuntimeError("no benefit expenditure and caseload tables edition in the GOV.UK collection")
    year, doc = best
    page = _content(doc["base_path"], f"dwp_{year}")
    published = date.fromisoformat(page["first_published_at"][:10])
    if since and published < since:
        return []
    out = []
    for a in page.get("details", {}).get("attachments", []):
        url, title = a.get("url") or "", a.get("title") or ""
        if url.lower().endswith(".xlsx") and re.search(r"outturn and forecast", title, re.I):
            out.append(download(SOURCE.id, url, vintage=_vintage(title, str(year))))
    if not out:
        raise RuntimeError(f"{doc['base_path']}: no 'Outturn and forecast tables' xlsx")
    SOURCE.published_on = max(SOURCE.published_on or published, published)
    return out


def _kind(text: str) -> str | None:
    t = text.lower()
    if "outturn" in t:
        return "outturn"
    if "forecast" in t or "projection" in t:
        return "forecast"
    return None


def read_block(grid: list[list], title: str, total_label: str) -> tuple[dict[str, float], dict[str, str], str]:
    """
    Values of `total_label` in the block whose heading starts with `title`.
    Returns (period -> value, period -> kind, unit text). Years are in the heading
    row; the kind is in the same cell ("2025/26 Forecast") or the row below.
    """
    for i, row in enumerate(grid):
        head = row[1] if len(row) > 1 else None
        if not (isinstance(head, str) and head.strip().lower().startswith(title.lower())):
            continue
        cols = {j: normalise_fiscal_year(v) for j, v in enumerate(row) if j > 1 and isinstance(v, str) and normalise_fiscal_year(v)}
        if not cols:
            continue
        below = grid[i + 1] if i + 1 < len(grid) else []
        unit = " ".join(str(x) for x in (head, below[1] if len(below) > 1 else "") if x)
        kinds = {}
        for j, p in cols.items():
            k = _kind(row[j]) or (_kind(below[j]) if j < len(below) and isinstance(below[j], str) else None)
            if k is None:
                raise ValueError(f"{title}: no Outturn/Forecast label for {p}")
            kinds[p] = k
        for r in grid[i + 1:i + 30]:
            label = r[1] if len(r) > 1 else None
            if isinstance(label, str) and label.strip().lower() == total_label.lower():
                values = {p: float(r[j]) for j, p in cols.items() if j < len(r) and isinstance(r[j], (int, float)) and not isinstance(r[j], bool)}
                return values, {p: kinds[p] for p in values}, unit
        raise ValueError(f"{title}: no {total_label!r} row")
    raise ValueError(f"no block {title!r}")


def parse(raws: list[RawArtifact]) -> list[Observation]:
    out: list[Observation] = []
    raw = next(r for r in raws if r.path.suffix.lower() == ".xlsx")
    vintage = raw.vintage or "DWP-unknown"
    wb = openpyxl.load_workbook(raw.path, read_only=True, data_only=True)
    try:
        ws = next(ws for ws in wb.worksheets if ws.title.strip().lower() == "state pension")
        grid = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()

    spend, kinds, unit = read_block(grid, "State Pension expenditure", "Total")
    if not re.search(r"£\s*million,\s*nominal", unit, re.I):
        raise ValueError(f"State Pension expenditure: unexpected unit {unit!r}")
    for p, v in spend.items():
        out.append(Observation(
            series_id="spending.state_pension", period=p, geography=GEOGRAPHY, value=round(v / 1000, 6), unit="gbp_bn",
            kind=kinds[p], source_id=SOURCE.id, vintage=vintage, quality="sourced",
            method_note="DWP 'State Pension' table, Total (contributory + Category D), £ million nominal / 1000. Great Britain plus overseas payees.",
        ))

    cases, kinds, unit = read_block(grid, "State Pension caseload", "Total State Pension Caseload")
    if "thousand" not in unit.lower():
        raise ValueError(f"State Pension caseload: unexpected unit {unit!r}")
    for p, v in cases.items():
        out.append(Observation(
            series_id="people.state_pension_caseload", period=p, geography=GEOGRAPHY, value=round(v / 1000, 6), unit="persons_m",
            kind=kinds[p], source_id=SOURCE.id, vintage=vintage, quality="sourced",
            method_note="DWP 'State Pension' table, average caseload over the financial year, thousands / 1000.",
        ))
    return out
