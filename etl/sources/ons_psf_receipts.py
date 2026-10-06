"""
ONS Public sector finances, Appendix D: public sector current receipts, by tax (outturn).

Why this module exists: the OBR Public finances databank (obr_databank.py) has receipts by tax
but no business-rates column; business rates sit in a residual "Other public sector taxes and
receipts" that also holds non-tax receipts. Appendix D is the official table the databank's
receipts columns come from, with every tax shown, so it gives the 13 Statement receipt lines
for outturn years. Its PSCR (JW2O) equals the databank's receipts.total to the £m when both
reflect the same PSF release (checked in the tests).

File: "Appendix D: public sector current receipts" xlsx, sheet "Time Series": monthly values,
£ million, not seasonally adjusted, accrued basis, one column per ONS CDID (row "Dataset
identifier code"). Fiscal-year values are sums of the 12 published months April-March; only
complete fiscal years from FIRST_FY are emitted.

Emitted (fiscal years, gbp_bn, kind "outturn", quality "sourced", vintage "PSF-YYYY-MM" = month of the
PSF release, the same convention as ons_psf):
  receipts.total = JW2O (public sector current receipts), so the build can take a year's receipts
      from this one table (TME, debt interest and PSNB then come from ons_psf).
  receipts.<line> for the 13 Statement lines, mapped from CDIDs in LINES below. The 13 lines sum
      to JW2O exactly: other_taxes = AHHY (total taxes and social contributions) minus the 11
      named tax lines, non_tax = JW2O - AHHY. Both equal sums of the remaining published rows
      (OTHER_TAX_ROWS, NON_TAX_ROWS), which the tests check to the £m.
  receipts.detail.ons_psf_receipts.<slug> for every column, so the mapping can be audited.

Definitions follow core.SERIES and OBR practice: income tax excludes CGT (ONS's LIBR includes
it); NICs exclude the immigration health surcharge (ONS books it inside social contributions);
VAT is net of VAT refunds to public bodies (refunds go to other taxes); corporation tax is
onshore + offshore excluding the energy profits levy (ONS books EPL inside offshore CT).
Unlike the databank, ONS onshore CT includes the diverted profits tax (£0.6bn in 2025-26).
"""

from __future__ import annotations

import re
import warnings
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import httpx
import openpyxl

from etl.core import Observation, RawArtifact, Source, download, fiscal_year, links

LANDING = "https://www.ons.gov.uk/economy/governmentpublicsectorandtaxes/publicsectorfinance/datasets/appendixdpublicsectorcurrentreceipts"
XLSX_URL = (
    "https://www.ons.gov.uk/file?uri=/economy/governmentpublicsectorandtaxes/publicsectorfinance/"
    "datasets/appendixdpublicsectorcurrentreceipts/current/publicsectorcurrentreceiptsappendixdfinal.xlsx"
)
XLSX_NAME = "appendix_d.xlsx"

SOURCE = Source(
    id="ons_psf_receipts",
    title="ONS Public sector finances: Appendix D, public sector current receipts",
    publisher="Office for National Statistics",
    url=LANDING,
    licence="OGL v3",
    cadence_days=31,  # monthly PSF release
    grace_days=14,
)

FIRST_FY = 2019  # 2019-20
SUM_TOLERANCE_BN = 0.01
DETAIL_PREFIX = "receipts.detail.ons_psf_receipts."

# Statement line -> ((CDID, sign), ...), and the method note naming what was summed.
LINES: dict[str, tuple[tuple[tuple[str, int], ...], str]] = {
    "receipts.income_tax": (
        (("MS6W", 1), ("LISB", 1), ("MF6X", 1)),
        "PAYE (MS6W) + self assessment (LISB) + other income tax (MF6X); excludes capital gains tax (MS62), which ONS includes in its income tax total (LIBR)",
    ),
    "receipts.nics": (
        (("AIIH", 1), ("FTA6", -1)),
        "Social contributions (AIIH) minus the immigration health surcharge (FTA6) that ONS records within them",
    ),
    "receipts.vat": ((("CTRU", 1),), "VAT net of VAT refunds to public bodies (CTRU); the refunds (AHGO) are in other_taxes"),
    "receipts.corp_tax": (
        (("CPSC", 1), ("CPSB", 1), ("JIS6", -1)),
        "Onshore corporation tax (CPSC, incl. bank surcharge, residential property developer tax and diverted profits tax) "
        "+ offshore corporation tax (CPSB) minus the energy profits levy (JIS6) that ONS records within offshore CT",
    ),
    "receipts.council_tax": ((("NMHM", 1),), "Council tax (NMHM)"),
    "receipts.business_rates": ((("CUKY", 1),), "Business rates (CUKY)"),
    "receipts.fuel_duty": ((("CUDG", 1),), "Fuel duties (CUDG)"),
    "receipts.stamp_duty": ((("MM9F", 1), ("BKST", 1)), "Stamp duty land tax (MM9F) + stamp taxes on shares (BKST)"),
    "receipts.cgt": ((("MS62", 1),), "Capital gains tax (MS62)"),
    "receipts.alcohol_tobacco": ((("GTAO", 1), ("MF6V", 1)), "Tobacco duties (GTAO) + alcohol duties (MF6V)"),
    "receipts.iht": ((("ACCH", 1),), "Inheritance tax (ACCH)"),
}
TOTAL_TAXES = "AHHY"  # total public sector taxes and social contributions
TOTAL = "JW2O"  # public sector current receipts
# The remaining published rows that other_taxes and non_tax equal (checked by the tests).
OTHER_TAX_ROWS: tuple[tuple[str, int], ...] = (
    ("AHGO", 1),  # VAT refunds
    ("FV2H", 1),  # customs duties
    ("EKED", 1),  # VED paid by businesses
    ("MF6W", 1),  # other taxes on production (APD, IPT, levies, apprenticeship levy, ETS, ...)
    ("ACCJ", 1),  # petroleum revenue tax
    ("JIS6", 1),  # energy profits levy
    ("MF6Z", 1),  # miscellaneous taxes on income and wealth
    ("CDDZ", 1),  # VED paid by households
    ("KIH3", 1),  # bank levy
    ("DH7A", 1),  # TV licence fee receipts
    ("MF72", 1), ("ACCH", -1),  # miscellaneous other taxes, excluding inheritance tax
    ("FTA6", 1),  # immigration health surcharge
    ("AHGR", 1),  # other local government taxes
)
NON_TAX_ROWS: tuple[tuple[str, int], ...] = (("AHHZ", 1), ("JW2K", 1), ("AHIO", 1))  # interest and dividends, GOS, other receipts

OTHER_TAXES_NOTE = (
    "Total public sector taxes and social contributions (AHHY) minus the 11 named tax lines; equals the sum of the remaining rows: "
    "VAT refunds (AHGO), customs (FV2H), VED (EKED+CDDZ), other taxes on production (MF6W), PRT (ACCJ), energy profits levy (JIS6), "
    "misc. taxes on income and wealth (MF6Z), bank levy (KIH3), licence fee (DH7A), misc. other taxes excl. IHT (MF72-ACCH), "
    "immigration health surcharge (FTA6), other local government taxes (AHGR)"
)
NON_TAX_NOTE = (
    "Public sector current receipts (JW2O) minus total taxes and social contributions (AHHY); equals interest and dividends (AHHZ) "
    "+ gross operating surplus (JW2K) + other public sector receipts (AHIO)"
)

TOTAL_NOTE = "Public sector current receipts (JW2O), the same CDID as the PSF time-series dataset; the 13 Statement lines sum to it exactly"

_MONTH_ROW = re.compile(r"^(\d{4}) ([A-Za-z]{3})$")
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# --------------------------------------------------------------------------- fetch


def fetch(since: date | None = None) -> list[RawArtifact]:
    """Download the current Appendix D workbook (one request, cached 20 h). `since` is unused: ONS replaces it monthly."""
    try:
        raw = download(SOURCE.id, XLSX_URL, XLSX_NAME)
    except httpx.HTTPStatusError:
        page = download(SOURCE.id, LANDING, "appendix_d_landing.html")
        found = links(page.path.read_text(errors="replace"), LANDING, r"appendixd[^/]*\.xlsx$|\.xlsx$")
        if not found:
            raise
        raw = download(SOURCE.id, found[0], XLSX_NAME)
    ed = read_edition(raw.path)
    raw.vintage = ed.vintage
    SOURCE.published_on = ed.published_on
    return [raw]


# --------------------------------------------------------------------------- reading


def _workbook(path: Path) -> dict[str, list[tuple]]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            return {ws.title.strip().lower(): [tuple(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
        finally:
            wb.close()


@dataclass
class Edition:
    vintage: str  # "PSF-2026-09": month the PSF release was published (same convention as ons_psf)
    published_on: date
    reference_month: str  # "August 2026": latest month of data


def _edition(book: dict[str, list[tuple]]) -> Edition:
    cover = book.get("cover sheet")
    if cover is None:
        raise ValueError(f"Appendix D: no 'Cover sheet'; sheets are {list(book)}")
    text = " ".join(" ".join(str(v).split()) for row in cover for v in row if v is not None)
    p = re.search(r"published at [^ ]+ (\d{1,2} \w+ \d{4})", text)
    t = re.search(r"Public sector current receipts, (\w+ \d{4})", text)
    if not p or not t:
        raise ValueError("Appendix D: publication date or reference month not found on the cover sheet")
    published = datetime.strptime(p.group(1), "%d %B %Y").date()
    return Edition(f"PSF-{published:%Y-%m}", published, t.group(1))


def read_edition(path: Path) -> Edition:
    return _edition(_workbook(path))


def slug(text: str) -> str:
    """'Other taxes on production - of which air passenger duty (£ millions)' -> 'other_taxes_on_production_air_passenger_duty'."""
    s = re.sub(r"\(£ millions\)|\[note \d+\]", " ", str(text), flags=re.I)
    s = re.sub(r"\bof which\b", " ", s, flags=re.I)
    s = re.sub(r"\([^)]*\)", " ", s).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


@dataclass
class Columns:
    labels: dict[str, str]  # CDID -> column label as published (one line)
    fy: dict[str, dict[str, float]]  # CDID -> {fiscal year: £bn, sum of 12 months}
    months: dict[str, tuple[str, str]]  # fiscal year -> (first month, last month), e.g. ("Apr 2025", "Mar 2026")


def read_columns(book: dict[str, list[tuple]]) -> Columns:
    rows = book.get("time series")
    if rows is None:
        raise ValueError(f"Appendix D: no 'Time Series' sheet; sheets are {list(book)}")
    code_row = next((r for r, row in enumerate(rows) if row and isinstance(row[0], str) and row[0].strip().lower() == "dataset identifier code"), None)
    if code_row is None or code_row == 0:
        raise ValueError("Appendix D: 'Dataset identifier code' row not found")
    cdids = {c: str(v).strip() for c, v in enumerate(rows[code_row]) if c > 0 and v is not None and str(v).strip()}
    labels = {cdid: " ".join(str(rows[code_row - 1][c]).split()) for c, cdid in cdids.items()}

    monthly: dict[str, dict[tuple[int, int], float]] = defaultdict(dict)
    for row in rows[code_row + 1:]:
        m = _MONTH_ROW.match(str(row[0]).strip()) if row and row[0] is not None else None
        if not m or m.group(2).lower() not in _MONTHS:
            continue
        ym = (int(m.group(1)), _MONTHS[m.group(2).lower()])
        for c, cdid in cdids.items():
            v = row[c] if c < len(row) else None
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                monthly[cdid][ym] = float(v)

    all_months = {ym for series in monthly.values() for ym in series}
    fy: dict[str, dict[str, float]] = defaultdict(dict)
    spans: dict[str, tuple[str, str]] = {}
    for start in sorted({y if mo >= 4 else y - 1 for (y, mo) in all_months}):
        if start < FIRST_FY:
            continue
        months = [(start, mo) for mo in range(4, 13)] + [(start + 1, mo) for mo in range(1, 4)]
        if not all(ym in all_months for ym in months):
            continue  # incomplete fiscal year
        period = fiscal_year(start)
        spans[period] = (f"Apr {start}", f"Mar {start + 1}")
        for cdid, series in monthly.items():
            if all(ym in series for ym in months):
                fy[cdid][period] = round(sum(series[ym] for ym in months) / 1000.0, 6)
    return Columns(labels, dict(fy), spans)


def combine(cols: Columns, terms: tuple[tuple[str, int], ...], period: str) -> float:
    missing = [c for c, _ in terms if period not in cols.fy.get(c, {})]
    if missing:
        raise ValueError(f"Appendix D {period}: no complete-year value for {missing}")
    return sum(sign * cols.fy[c][period] for c, sign in terms)


# --------------------------------------------------------------------------- parse


def parse(raws: list[RawArtifact]) -> list[Observation]:
    raw = next((r for r in raws if r.source_id == SOURCE.id and r.path.suffix == ".xlsx"), None)
    if raw is None:
        raise ValueError("ons_psf_receipts.parse: no Appendix D xlsx among the raw artifacts")
    book = _workbook(raw.path)
    ed = _edition(book)
    vintage = raw.vintage or ed.vintage
    cols = read_columns(book)
    for cdid in {c for terms, _ in LINES.values() for c, _ in terms} | {TOTAL_TAXES, TOTAL}:
        if cdid not in cols.labels:
            raise ValueError(f"Appendix D: CDID {cdid} not in the Time Series sheet")

    def obs(series_id: str, period: str, value: float, note: str) -> Observation:
        first, last = cols.months[period]
        return Observation(
            series_id=series_id, period=period, value=round(value, 6), unit="gbp_bn", kind="outturn",
            source_id=SOURCE.id, vintage=vintage, quality="sourced",
            method_note=f"{note}. ONS PSF Appendix D, sum of the 12 monthly values {first} to {last}.",
        )

    out: list[Observation] = []
    for period in sorted(cols.months):
        named = 0.0
        for series_id, (terms, note) in LINES.items():
            v = combine(cols, terms, period)
            named += v
            out.append(obs(series_id, period, v, note))
        taxes = combine(cols, ((TOTAL_TAXES, 1),), period)
        total = combine(cols, ((TOTAL, 1),), period)
        out.append(obs("receipts.other_taxes", period, taxes - named, OTHER_TAXES_NOTE))
        out.append(obs("receipts.non_tax", period, total - taxes, NON_TAX_NOTE))
        out.append(obs("receipts.total", period, total, TOTAL_NOTE))

    seen: dict[str, str] = {}
    for cdid, lab in cols.labels.items():
        sid = DETAIL_PREFIX + slug(lab)
        if sid in seen:
            sid = f"{sid}_{cdid.lower()}"
        seen[sid] = cdid
        for period, v in sorted(cols.fy.get(cdid, {}).items()):
            out.append(obs(sid, period, v, f"Column '{lab}' [{cdid}]"))
    return out
