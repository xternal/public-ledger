"""
HMRC Income Tax liabilities statistics, Table 2.1 "Number of individual Income
Tax payers by marginal rate, sex and age".

Page:   https://www.gov.uk/government/statistics/number-of-individual-income-taxpayers-by-marginal-rate-gender-and-age
Found:  GOV.UK content API for that page -> the ods/xlsx attachment.

Emits   people.income_taxpayers                  all Income Tax payers (persons_m)
        people.income_taxpayers.basic_rate        "Basic rate" column (excludes savers-rate payers)
        people.income_taxpayers.higher_rate
        people.income_taxpayers.additional_rate
period = tax year "YYYY-YY". Years up to the latest Survey of Personal Incomes
(SPI) are outturn; later years are HMRC projections (kind "projection"), which
HMRC revises until SPI data replaces them. HMRC rounds to 3 significant figures.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from etl.core import Observation, RawArtifact, Source, download, normalise_fiscal_year

SOURCE = Source(
    id="hmrc_taxpayers",
    title="HMRC: Income Tax liabilities statistics, Table 2.1 Number of individual Income Tax payers",
    publisher="HMRC",
    url="https://www.gov.uk/government/statistics/number-of-individual-income-taxpayers-by-marginal-rate-gender-and-age",
    cadence_days=365,
    grace_days=60,
)

CONTENT_API = "https://www.gov.uk/api/content/government/statistics/number-of-individual-income-taxpayers-by-marginal-rate-gender-and-age"
SHEET_SUFFIXES = (".ods", ".xlsx", ".xls")

COLUMNS = {
    "people.income_taxpayers": r"^all income tax payers",
    "people.income_taxpayers.basic_rate": r"^basic rate",
    "people.income_taxpayers.higher_rate": r"^higher rate",
    "people.income_taxpayers.additional_rate": r"^additional rate",
}


def _edition(content: dict) -> date | None:
    stamps = [c.get("public_timestamp") for c in content.get("details", {}).get("change_history", []) if c.get("public_timestamp")]
    stamps = stamps or [s for s in (content.get("public_updated_at"),) if s]
    return max(datetime.fromisoformat(s.replace("Z", "+00:00")).date() for s in stamps) if stamps else None


def vintage_for(day: date | None) -> str:
    return f"HMRC-ITLS-{day:%Y-%m}" if day else "HMRC-ITLS-unknown"


def fetch(since: date | None = None) -> list[RawArtifact]:
    """Content API -> latest Table 2.1 spreadsheet. [] if `since` is given and nothing newer."""
    meta = download(SOURCE.id, CONTENT_API, "table_2_1.json")
    content = json.loads(meta.path.read_text())
    published = _edition(content)
    SOURCE.published_on = published
    vintage = vintage_for(published)
    meta.vintage = vintage
    if since and published and published <= since:
        return []
    sheets = [
        a
        for a in content.get("details", {}).get("attachments", [])
        if "spreadsheet" in (a.get("content_type") or "") or (a.get("url") or "").lower().endswith(SHEET_SUFFIXES)
    ]
    if not sheets:
        raise RuntimeError(f"{SOURCE.id}: no spreadsheet attachment on {SOURCE.url}")
    return [meta, download(SOURCE.id, sheets[0]["url"], vintage=vintage)]


def _clean(x) -> str:
    return " ".join(str(x).replace("\xa0", " ").split())


def _num(x) -> float | None:
    if isinstance(x, (int, float)) and not pd.isna(x):
        return float(x)
    s = _clean(x).replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None  # "[not applicable]", "[x]", blanks


def _projection_notes(sheets: dict[str, pd.DataFrame]) -> set[str]:
    """Note numbers whose text says the year is a projection."""
    out: set[str] = set()
    for name, df in sheets.items():
        if "note" not in name.lower() and "footnote" not in name.lower():
            continue
        for row in df.values.tolist():
            if len(row) >= 2 and re.search(r"project", _clean(row[1]), re.I):
                m = re.match(r"\s*(\d+)", _clean(row[0]))
                if m:
                    out.add(m.group(1))
    return out


def _spi_year(sheets: dict[str, pd.DataFrame]) -> str | None:
    """'Source: Survey of Personal Incomes 2023 to 2024' -> '2023-24' (the last outturn year)."""
    for df in sheets.values():
        for cell in df.iloc[:, 0].dropna().tolist():
            m = re.search(r"Survey of Personal Incomes (\d{4}) to (\d{4})", _clean(cell))
            if m:
                return normalise_fiscal_year(f"{m.group(1)}-{m.group(2)}")
    return None


def parse_table(path: Path) -> list[dict]:
    """[{series_id, period, value_m, kind}] from Table 2.1."""
    engine = "odf" if path.suffix.lower() == ".ods" else None
    sheets = pd.read_excel(path, sheet_name=None, header=None, engine=engine)
    projected_notes = _projection_notes(sheets)
    spi = _spi_year(sheets)

    for df in sheets.values():
        rows = df.values.tolist()
        header_at = next((i for i, r in enumerate(rows) if re.match(r"tax year", _clean(r[0]), re.I)), None)
        if header_at is None:
            continue
        header = [_clean(c) for c in rows[header_at]]
        cols = {sid: next((i for i, h in enumerate(header) if re.search(rx, h, re.I)), None) for sid, rx in COLUMNS.items()}
        if cols["people.income_taxpayers"] is None:
            continue
        above = " ".join(_clean(r[0]) for r in rows[:header_at]).lower()
        scale = 0.001 if "thousand" in above else (1.0 if "million" in above else 0.001)

        out: list[dict] = []
        for r in rows[header_at + 1 :]:
            label = _clean(r[0])
            m = re.match(r"(\d{4})\s*(?:to|-|/)\s*(\d{2,4})", label)
            if not m:
                continue
            period = normalise_fiscal_year(f"{m.group(1)}-{m.group(2)}")
            notes = set(re.findall(r"\[note (\d+)\]", label, re.I))
            if notes & projected_notes:
                kind = "projection"
            elif spi and not projected_notes and period > spi:
                kind = "projection"
            else:
                kind = "outturn"
            for sid, c in cols.items():
                if c is None:
                    continue
                v = _num(r[c])
                if v is None:
                    continue
                out.append({"series_id": sid, "period": period, "value_m": round(v * scale, 6), "kind": kind})
        if out:
            return out
    raise ValueError(f"hmrc_taxpayers: no 'Tax year' table with an 'All Income Tax payers' column in {path.name}")


def parse(raws: list[RawArtifact]) -> list[Observation]:
    sheet = next((r for r in raws if r.path.suffix.lower() in SHEET_SUFFIXES), None)
    if sheet is None:
        raise ValueError("hmrc_taxpayers: no spreadsheet among the raw files")
    vintage = sheet.vintage
    content = next((r for r in raws if r.path.suffix == ".json"), None)
    if not vintage and content:
        vintage = vintage_for(_edition(json.loads(content.path.read_text())))
    vintage = vintage or "HMRC-ITLS-unknown"
    obs = []
    for r in parse_table(sheet.path):
        note = None
        if r["kind"] == "projection":
            note = "HMRC projection from the latest Survey of Personal Incomes, using OBR economic assumptions; revised until SPI outturn replaces it."
        obs.append(
            Observation(
                series_id=r["series_id"],
                period=r["period"],
                value=r["value_m"],
                unit="persons_m",
                kind=r["kind"],
                source_id=SOURCE.id,
                vintage=vintage,
                quality="sourced",
                method_note=note,
            )
        )
    return obs
