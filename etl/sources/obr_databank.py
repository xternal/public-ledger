"""
OBR Public finances databank: history (and the latest OBR forecast) of the fiscal aggregates.

The workbook is linked from https://obr.uk/data/ as "Public finances databank – <Month YYYY>"
(a /download/public-finances-databank-<month>-<yyyy>/ link that redirects to an xlsx under
/docs/dlm_uploads/). OBR refreshes it about two working days after each ONS/HMT Public sector
finances (PSF) release and after each EFO. Outturn rows are the ONS PSF figures; rows from the
year named in the sheet note "Forecast years from YYYY-YY ..." are the latest EFO forecast.

Sheets used (columns are found by their header text, rows by their fiscal-year label):

    "Aggregates (£bn)"              receipts.total (JW2O), spending.tme (KX5Q),
                                    spending.debt_interest (NMFX+MU74, CG debt interest net of APF),
                                    fiscal.psnb (-J5II), fiscal.psnd (HF6W), macro.nominal_gdp (BKTL)
                                    + extras: spending.psce, spending.psni, spending.depreciation,
                                    fiscal.current_budget_deficit, fiscal.psnfl, fiscal.psnd_ex_boe,
                                    macro.nominal_gdp_centred
    "Aggregates (per cent of GDP)"  fiscal.psnd_pct_gdp (+ fiscal.psnd_ex_boe_pct_gdp). This is the
                                    published ratio (ONS HF6X for outturn); it is not equal to PSND
                                    divided by the sheet's centred-GDP column for the latest year.
    "Receipts (£bn)"                every column as receipts.detail.obr_databank.<slug> (audit only).

Receipts by tax: the databank has no business-rates column (business rates sit inside a residual
"Other public sector taxes and receipts" that mixes taxes with non-tax receipts), so the 13
Statement receipt lines for outturn years come from etl/sources/ons_psf_receipts.py (ONS PSF
Appendix D), which matches this workbook to the £m when both reflect the same PSF release.
Forecast-year receipt lines are left to obr_efo.
"""

from __future__ import annotations

import calendar
import json
import re
import warnings
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import openpyxl

from etl.core import RAW_DIR, Observation, RawArtifact, Source, download, links

SOURCE = Source(
    id="obr_databank",
    title="OBR Public finances databank",
    publisher="Office for Budget Responsibility",
    url="https://obr.uk/data/",
    licence="OGL v3",
    cadence_days=31,  # refreshed after every monthly PSF release
    grace_days=21,
)

DATA_PAGE = "https://obr.uk/data/"
XLSX_NAME = "public_finances_databank.xlsx"
PAGE_NAME = "data_page.html"
FIRST_FY = "2019-20"
MAX_AGE = timedelta(hours=20)

_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
_LINK = re.compile(r"/download/public-finances-databank-([a-z]+)-(\d{4})/?", re.I)
_FY_CELL = re.compile(r"^\d{4}-\d{2}$")

SHEET_GBP = "aggregates (£bn)"
SHEET_PCT = "aggregates (per cent of gdp)"
SHEET_RECEIPTS = "receipts (£bn)"

# series_id -> (sheet, normalised column header, unit). Headers are matched after label() below.
AGGREGATES: dict[str, tuple[str, str, str]] = {
    "receipts.total": (SHEET_GBP, "public sector current receipts", "gbp_bn"),
    "spending.tme": (SHEET_GBP, "total managed expenditure", "gbp_bn"),
    "spending.debt_interest": (SHEET_GBP, "central government debt interest, net of apf", "gbp_bn"),
    "fiscal.psnb": (SHEET_GBP, "public sector net borrowing", "gbp_bn"),
    "fiscal.psnd": (SHEET_GBP, "public sector net debt", "gbp_bn"),
    "macro.nominal_gdp": (SHEET_GBP, "nominal gdp (£ billion)", "gbp_bn"),
    "fiscal.psnd_pct_gdp": (SHEET_PCT, "public sector net debt", "pct_gdp"),
}
REQUIRED = list(AGGREGATES)

EXTRAS: dict[str, tuple[str, str, str]] = {
    "spending.psce": (SHEET_GBP, "public sector current expenditure", "gbp_bn"),
    "spending.psni": (SHEET_GBP, "public sector net investment", "gbp_bn"),
    "spending.depreciation": (SHEET_GBP, "depreciation", "gbp_bn"),
    "fiscal.current_budget_deficit": (SHEET_GBP, "current budget deficit", "gbp_bn"),
    "fiscal.psnfl": (SHEET_GBP, "public sector net financial liabilities", "gbp_bn"),
    "fiscal.psnd_ex_boe": (SHEET_GBP, "public sector net debt ex boe", "gbp_bn"),
    "fiscal.psnd_ex_boe_pct_gdp": (SHEET_PCT, "public sector net debt (ex boe)", "pct_gdp"),
    "macro.nominal_gdp_centred": (SHEET_GBP, "nominal gdp, centred end-march (£ billion)", "gbp_bn"),
}

DETAIL_PREFIX = "receipts.detail.obr_databank."


# --------------------------------------------------------------------------- fetch


def _download_cached(url: str, filename: str, vintage: str | None = None) -> RawArtifact:
    """
    core.download() compares the cached file's *final* URL with the requested one, so a
    link that redirects (OBR /download/ links do) is never served from cache. Reuse a
    fresh file fetched from the same requested URL here instead of hitting OBR again.
    """
    meta_path = RAW_DIR / SOURCE.id / f"{filename}.meta.json"
    path = RAW_DIR / SOURCE.id / filename
    if path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        fetched = datetime.fromisoformat(meta["fetched_at"])
        if meta.get("requested_url") == url and datetime.now(timezone.utc) - fetched < MAX_AGE:
            if vintage and meta.get("vintage") != vintage:
                meta["vintage"] = vintage
                meta_path.write_text(json.dumps(meta, indent=2))
            return RawArtifact.from_meta(SOURCE.id, meta["url"], path, meta, vintage)
    return download(SOURCE.id, url, filename, vintage=vintage, archive=True)


def find_databank_link(html: str) -> tuple[str, str]:
    """(download URL, vintage) of the current databank on the OBR data page, e.g. ("…-september-2026/", "OBR-PFD-2026-09")."""
    for href in links(html, DATA_PAGE, _LINK.pattern):
        m = _LINK.search(href)
        if m and m.group(1).lower() in _MONTHS:
            return href.split("?")[0], f"OBR-PFD-{m.group(2)}-{_MONTHS[m.group(1).lower()]:02d}"
    raise ValueError("no 'Public finances databank – <Month YYYY>' download link on https://obr.uk/data/")


def fetch(since: date | None = None) -> list[RawArtifact]:
    """
    Find the current databank on the OBR data page and download it (both cached 20 h). `since` is unused: the file is cumulative.
    OBR refuses GitHub's servers; both requests then go through the Internet Archive (etl/wayback.py).
    """
    page = download(SOURCE.id, DATA_PAGE, PAGE_NAME, archive=True)
    html = page.path.read_text(errors="replace")
    url, vintage = find_databank_link(html)
    raw = _download_cached(url, XLSX_NAME, vintage)
    raw.vintage = vintage
    SOURCE.published_on = _published_on(html) or read_edition(raw.path, vintage).psf_release
    return [raw]


# --------------------------------------------------------------------------- workbook reading


def label(text) -> str:
    """Normalise a header cell: drop trailing footnote digits ("Public sector net debt2"), collapse spaces, lower-case."""
    s = " ".join(str(text).split())
    s = re.sub(r"(?<=[A-Za-z)])\d+$", "", s)
    return s.strip().lower()


def slug(text: str) -> str:
    """'Onshore corporation tax (includes Bank Surcharge and EGL)3' -> 'onshore_corporation_tax'."""
    s = re.sub(r"\([^)]*\)", " ", label(text))
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _workbook(path: Path) -> dict[str, list[tuple]]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # openpyxl: "Cannot parse header or footer" (raised while reading rows)
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            return {ws.title.strip().lower(): [tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
        finally:
            wb.close()


def _sheet(book: dict[str, list[tuple]], name: str) -> list[tuple]:
    for title, rows in book.items():
        if title.startswith(name):
            return rows
    raise ValueError(f"databank: sheet {name!r} not found; sheets are {list(book)}")


@dataclass
class Table:
    headers: dict[int, str]  # column -> normalised header
    raw_headers: dict[int, str]  # column -> header as published
    codes: dict[int, str]  # column -> ONS code from the row under the headers, if any
    years: dict[int, str]  # row -> fiscal year
    rows: list[tuple]

    def column(self, header: str, sheet: str) -> int:
        cols = [c for c, h in self.headers.items() if h == header]
        if len(cols) != 1:
            raise ValueError(f"databank {sheet!r}: expected one column headed {header!r}, found {len(cols)}")
        return cols[0]

    def series(self, col: int) -> dict[str, float]:
        out = {}
        for r, fy in self.years.items():
            v = self.rows[r][col] if col < len(self.rows[r]) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out[fy] = float(v)
        return out


def _table(rows: list[tuple], anchor: str = "public sector current receipts") -> Table:
    # Year column: the column with the most "YYYY-YY" cells.
    counts: dict[int, int] = {}
    for row in rows:
        for c, v in enumerate(row):
            if isinstance(v, str) and _FY_CELL.match(v.strip()):
                counts[c] = counts.get(c, 0) + 1
    if not counts:
        raise ValueError("databank: no fiscal-year column")
    ycol = max(counts, key=counts.get)
    years = {r: row[ycol].strip() for r, row in enumerate(rows) if ycol < len(row) and isinstance(row[ycol], str) and _FY_CELL.match(row[ycol].strip())}
    first = min(years)
    # Header row: above the data, contains the anchor, and has the most text cells.
    cands = [r for r in range(first) if any(isinstance(v, str) and label(v) == anchor for v in rows[r])]
    if not cands:
        raise ValueError(f"databank: header row with {anchor!r} not found")
    hr = max(cands, key=lambda r: sum(isinstance(v, str) for v in rows[r]))
    raw_headers = {c: " ".join(v.split()) for c, v in enumerate(rows[hr]) if isinstance(v, str) and c != ycol}
    headers = {c: label(v) for c, v in raw_headers.items()}
    codes = {}
    if hr + 1 < first:
        codes = {c: str(v).strip() for c, v in enumerate(rows[hr + 1]) if c in headers and v is not None}
    return Table(headers, raw_headers, codes, years, rows)


@dataclass
class Edition:
    vintage: str
    psf_release: date | None  # the PSF bulletin the outturn is consistent with
    forecast_from: str  # first fiscal year that is forecast
    forecast_label: str  # e.g. "OBR Economic and fiscal outlook forecast published March 2026"


def _notes(rows: list[tuple]) -> str:
    return " ".join(" ".join(v.split()) for row in rows for v in row if isinstance(v, str))


def read_edition(path: Path, vintage: str | None = None) -> Edition:
    return _edition(_workbook(path), vintage)


def _edition(book: dict[str, list[tuple]], vintage: str | None) -> Edition:
    text = _notes(_sheet(book, SHEET_GBP))
    m = re.search(r"Forecast years from (\d{4}-\d{2})", text)
    if not m:
        raise ValueError("databank: note 'Forecast years from YYYY-YY' not found; cannot tell outturn from forecast")
    forecast_from = m.group(1)
    f = re.search(r"consistent with the (OBR [^.]*?forecast published \w+ \d{4})", text)
    forecast_label = f.group(1) if f else "OBR forecast"
    r = re.search(r"Statistical Bulletin released on (\d{1,2} \w+ \d{4})", text)
    psf_release = datetime.strptime(r.group(1), "%d %B %Y").date() if r else None
    if not vintage:
        if psf_release is None:
            raise ValueError("databank: no edition label and no PSF release date in the notes")
        vintage = f"OBR-PFD-{psf_release:%Y-%m}"
    return Edition(vintage, psf_release, forecast_from, forecast_label)


def _published_on(page_html: str) -> date | None:
    """The date OBR shows under the databank link: 'Public finances databank – September 2026 24 September 2026 – 501.75 KB'."""
    from bs4 import BeautifulSoup

    text = " ".join(BeautifulSoup(page_html, "html.parser").get_text(" ").split())
    m = re.search(r"Public finances databank\s*[–-]\s*\w+ \d{4}\s+(\d{1,2} \w+ \d{4})\s*[–-]", text)
    try:
        return datetime.strptime(m.group(1), "%d %B %Y").date() if m else None
    except ValueError:
        return None


# --------------------------------------------------------------------------- parse


def _fy_ge(a: str, b: str) -> bool:
    return int(a[:4]) >= int(b[:4])


def parse(raws: list[RawArtifact]) -> list[Observation]:
    raw = next((r for r in raws if r.source_id == SOURCE.id and r.path.suffix == ".xlsx"), None)
    if raw is None:
        raise ValueError("obr_databank.parse: no databank xlsx among the raw artifacts")
    book = _workbook(raw.path)
    ed = _edition(book, raw.vintage)
    tables = {name: _table(_sheet(book, name)) for name in (SHEET_GBP, SHEET_PCT, SHEET_RECEIPTS)}

    def kind(fy: str) -> str:
        return "forecast" if _fy_ge(fy, ed.forecast_from) else "outturn"

    def note(fy: str, base: str | None) -> str | None:
        if kind(fy) == "forecast":
            fc = f"Forecast: {ed.forecast_label}, as carried in the databank."
            return f"{base} {fc}" if base else fc
        return base

    def obs(series_id: str, fy: str, value: float, unit: str, base_note: str | None = None) -> Observation:
        return Observation(
            series_id=series_id, period=fy, value=round(value, 6), unit=unit, kind=kind(fy),
            source_id=SOURCE.id, vintage=ed.vintage, quality="sourced", method_note=note(fy, base_note),
        )

    out: list[Observation] = []
    for series_id, (sheet, header, unit) in {**AGGREGATES, **EXTRAS}.items():
        t = tables[sheet]
        col = t.column(header, sheet)
        for fy, v in t.series(col).items():
            if _fy_ge(fy, FIRST_FY):
                out.append(obs(series_id, fy, v, unit))

    # Receipts sheet: every published column, for auditing the Statement lines.
    t = tables[SHEET_RECEIPTS]
    seen: set[str] = set()
    for col, raw_header in t.raw_headers.items():
        if not t.series(col):
            continue
        sid = DETAIL_PREFIX + slug(raw_header)
        if sid in seen:
            raise ValueError(f"databank receipts: two columns slug to {sid}")
        seen.add(sid)
        code = t.codes.get(col)
        base = f"OBR databank 'Receipts (£bn)' column '{raw_header}'" + (f" [{code}]" if code else "") + "."
        for fy, v in t.series(col).items():
            if _fy_ge(fy, FIRST_FY):
                out.append(obs(sid, fy, v, "gbp_bn", base))
    return out


def latest_outturn_year(obs: list[Observation]) -> str:
    return max(o.period for o in obs if o.series_id == "receipts.total" and o.kind == "outturn")
