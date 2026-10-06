"""
HM Treasury Public Expenditure Statistical Analyses (PESA) and the Public
Spending Statistics (PSS) releases that update it.

What we take (all UK, £bn, fiscal years):

- Table "Public sector expenditure on services by sub-function" (PESA 5.2, £m,
  last five years): every COFOG function and sub-function, EU transactions,
  total expenditure on services (TES), accounting adjustments and TME.
- Table "Public sector expenditure on services by function" (PESA 4.2, £bn,
  from 2003-04; PSS Table 9): the same functions, debt interest, TES,
  accounting adjustments and TME for the earlier years 5.2 does not cover.
- Table "Public expenditure aggregates" (PESA 4.1, £bn, from 1985-86): TME for
  years outside the functional tables, including the plan years after the
  latest outturn year (kind "forecast").

Series ids: spending.tes.total, spending.cofog.<function>, spending.cofog.
<function>.<sub_function>[.<of_which>], spending.cofog.eu_transactions[.*],
spending.accounting_adjustments, spending.tme (see etl/core.py SERIES).

Note on debt interest: PESA's "public debt transactions" (COFOG 1.7) is gross
payments to the private sector and overseas, plus the Bank of England's Asset
Purchase Facility and the notional interest on unfunded public service pension
liabilities. It is therefore larger than OBR's "central government debt
interest, net of APF" (spending.debt_interest). Both are kept, each under its
own id; the of-which rows let the build reconcile them.

Edition choice: fetch() looks at the latest PESA edition and the latest PSS
release (only if it was published after that PESA). parse() keeps one edition:
the one with the most recent outturn year; ties go to the edition with the
sub-function table, then to the later release, then to PESA (the command
paper). So every observation has the same vintage and the tables reconcile.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import openpyxl

from etl.core import Observation, RawArtifact, Source, download, normalise_fiscal_year

GOVUK = "https://www.gov.uk"
CONTENT_API = "https://www.gov.uk/api/content"
PESA_COLLECTION = "/government/collections/public-expenditure-statistical-analyses-pesa"
PSS_COLLECTION = "/government/collections/national-statistics-release"  # "HMT Public Spending Statistics"

SOURCE = Source(
    id="hmt_pesa",
    title="HM Treasury Public Expenditure Statistical Analyses (PESA) / Public Spending Statistics",
    publisher="HM Treasury",
    url=GOVUK + PESA_COLLECTION,
    licence="OGL v3",
    published_on=date(2026, 7, 16),  # PESA 2026; fetch() updates it to the newest edition found
    cadence_days=120,  # PSS releases Feb, May, July (with PESA), Nov
    grace_days=45,
)

UNIT = "gbp_bn"

FUNCTIONS = {
    1: "general_public_services",
    2: "defence",
    3: "public_order",
    4: "economic_affairs",
    5: "environment_protection",
    6: "housing_amenities",
    7: "health",
    8: "recreation_culture",
    9: "education",
    10: "social_protection",
}
EU = "eu_transactions"
DEBT_INTEREST = "debt_interest"

TES = "spending.tes.total"
ACCOUNTING = "spending.accounting_adjustments"
TME = "spending.tme"

# Labels whose generic slug is too long or misleading. Keyed by the cleaned label.
SLUG_OVERRIDES = {
    "executive and legislative organs, financial and fiscal affairs, external affairs": "executive_legislative_fiscal_external",
    "public debt transactions": DEBT_INTEREST,
    "central government debt interest": "central_government",
    "local government debt interest": "local_government",
    "public corporation debt interest": "public_corporations",
    "general economic, commercial and labour affairs": "general_economic_commercial_labour",
    "agriculture, forestry, fishing and hunting": "agriculture_forestry_fishing",
    "other agriculture, food and fisheries policy": "other_agriculture_food_fisheries",
    "mining, manufacturing and construction": "mining_manufacturing_construction",
    "protection of biodiversity and landscape": "biodiversity_landscape",
    "housing and community amenities": "housing_community_amenities",
    "pre-primary and primary education": "pre_primary_and_primary",
    "post-secondary non-tertiary education": "post_secondary_non_tertiary",
    "education not definable by level": "not_definable_by_level",
    "subsidiary services to education": "subsidiary_services",
    "incapacity, disability and injury benefits": "incapacity_disability_injury_benefits",
    "family benefits, income support and tax credits": "family_benefits_income_support_tax_credits",
    "family benefits, income support, universal credit and tax credits": "family_benefits_income_support_uc_tax_credits",
}

# EU transactions block in the sub-function table: the "derived as:" rows are
# the components of the net contribution. (pattern, slug, parent slug or None)
EU_ROWS = [
    (r"^vat-based and gni-based contributions", "contributions_net", None),
    (r"^eu gross contribution", "gross_contribution", "contributions_net"),
    (r"^traditional own resources", "traditional_own_resources", "contributions_net"),
    (r"^uk abatement", "uk_abatement", "contributions_net"),
    (r"^eu receipts", "eu_receipts", None),
    (r"^other attributed costs", "other_attributed_costs", None),
]

MEMO_NOTE = "Memo 'of which' row spanning several sub-functions; it is not additive with its siblings."


# ---------------------------------------------------------------------------
# fetch


def _content(path: str, name: str) -> dict:
    """GOV.UK content API JSON, cached through download() like any raw file."""
    raw = download(SOURCE.id, CONTENT_API + path, filename=f"govuk_{name}.json")
    return json.loads(raw.path.read_text())


def _latest_pesa(collection: dict) -> dict | None:
    best = None
    for doc in collection.get("links", {}).get("documents", []):
        m = re.fullmatch(r"/government/statistics/public-expenditure-statistical-analyses-(\d{4})", doc.get("base_path", ""))
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), doc)
    return best[1] if best else None


def _latest_pss(collection: dict) -> dict | None:
    docs = [
        d for d in collection.get("links", {}).get("documents", [])
        if re.fullmatch(r"/government/statistics/public-spending-statistics-release-[a-z]+-\d{4}", d.get("base_path", ""))
    ]
    # public_updated_at moves with corrections; order by the release month in the path instead.
    def key(d):
        m = re.search(r"-([a-z]+)-(\d{4})$", d["base_path"])
        return (int(m.group(2)), _MONTHS.get(m.group(1)[:3], 0))

    return max(docs, key=key) if docs else None


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Workbooks that hold the function, sub-function and aggregates tables:
# PESA "Chapter 4/5 tables", July PSS "Chapter_4/5", Feb/May/Nov PSS "..._TES".
WANTED_FILE = re.compile(r"(chapter_?[45](?!\d)|_tes(?=[._]))", re.I)
WANTED_TITLE = re.compile(r"(chapter\s*[45]\b|^expenditure on services|^trends in public spending|^public sector spending)", re.I)


def _edition_files(base_path: str, name: str) -> tuple[str, date, list[str]]:
    doc = _content(base_path, name)
    published = date.fromisoformat(doc["first_published_at"][:10])
    urls = []
    for a in doc.get("details", {}).get("attachments", []):
        url = a.get("url") or ""
        if not url.lower().endswith((".xlsx", ".ods")):
            continue
        if WANTED_FILE.search(Path(url).name) or WANTED_TITLE.search(a.get("title") or ""):
            urls.append(url if url.startswith("http") else GOVUK + url)
    return doc.get("title", base_path), published, urls


def fetch(since: date | None = None) -> list[RawArtifact]:
    pesa_doc = _latest_pesa(_content(PESA_COLLECTION, "pesa_collection"))
    if pesa_doc is None:
        raise RuntimeError("no PESA edition found in the GOV.UK collection")
    year = re.search(r"(\d{4})$", pesa_doc["base_path"]).group(1)
    editions = []
    _, pesa_published, pesa_urls = _edition_files(pesa_doc["base_path"], f"pesa_{year}")
    editions.append((f"PESA-{year}", pesa_published, pesa_urls))

    pss_doc = _latest_pss(_content(PSS_COLLECTION, "pss_collection"))
    if pss_doc is not None:
        m = re.search(r"-([a-z]+)-(\d{4})$", pss_doc["base_path"])
        vintage = f"PSS-{m.group(2)}-{_MONTHS[m.group(1)[:3]]:02d}"
        _, pss_published, pss_urls = _edition_files(pss_doc["base_path"], vintage.lower().replace("-", "_"))
        # The July PSS is published with PESA and holds the same tables: only a later release adds anything.
        if pss_published > pesa_published:
            editions.append((vintage, pss_published, pss_urls))

    out: list[RawArtifact] = []
    for vintage, published, urls in editions:
        if since and published < since:
            continue
        if not urls:
            raise RuntimeError(f"{vintage}: no function tables among the attachments")
        for url in urls:
            out.append(download(SOURCE.id, url, vintage=vintage))
        SOURCE.published_on = max(SOURCE.published_on or published, published)
    return out


# ---------------------------------------------------------------------------
# parse: reading the tables


@dataclass
class Row:
    series_id: str
    values: dict[str, float]  # period -> £bn
    level: int  # 0 total, 1 function, 2 sub-function, 3 of-which
    parent: str | None = None
    memo: bool = False  # an of-which that spans siblings (not additive)


@dataclass
class Table:
    name: str  # e.g. "Table 5.2"
    title: str
    periods: list[str]
    kinds: dict[str, str]  # period -> outturn | forecast
    rows: list[Row] = field(default_factory=list)

    def get(self, series_id: str) -> Row | None:
        return next((r for r in self.rows if r.series_id == series_id), None)


@dataclass
class Edition:
    vintage: str
    function: Table | None = None
    subfunction: Table | None = None
    aggregates: Table | None = None

    @property
    def latest_outturn(self) -> str:
        periods = [p for t in (self.function, self.subfunction) if t for p in t.periods if t.kinds[p] == "outturn"]
        return max(periods) if periods else ""

    def order(self) -> tuple:
        m = re.match(r"(PESA|PSS)-(\d{4})(?:-(\d{2}))?$", self.vintage)
        released = (int(m.group(2)), int(m.group(3) or 7)) if m else (0, 0)
        return (self.latest_outturn, self.subfunction is not None, released, bool(m) and m.group(1) == "PESA")


TITLE_FUNCTION = re.compile(r"^Table\s+(\S+)\s+Public sector expenditure on services by function,\s*\d{4}", re.I)
TITLE_SUBFUNCTION = re.compile(r"^Table\s+(\S+)\s+Public sector expenditure on services by sub-function,\s*\d{4}", re.I)
TITLE_AGGREGATES = re.compile(r"^Table\s+(\S+)\s+Public expenditure aggregates,\s*\d{4}", re.I)


def _clean(label) -> str:
    s = re.sub(r"\s+", " ", str(label)).strip()
    s = re.sub(r"\s*\(\d+\)(\s*,\s*\(\d+\))*", "", s)  # footnote markers: "(2), (3)", "Defence(1)"
    return s.strip()


def _number(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v.strip() in {"-", "–", "—"}:
        return 0.0  # PESA: "-" is nil or less than £0.5 million
    return None


def _grid(ws) -> list[list]:
    return [list(r) for r in ws.iter_rows(values_only=True)]


def _title(grid: list[list]) -> str:
    for row in grid[:3]:
        for v in row:
            if isinstance(v, str) and v.strip():
                return re.sub(r"\s+", " ", v).strip()
    return ""


def _scale(grid: list[list], header_rows: int) -> float:
    text = " ".join(str(v) for row in grid[:header_rows] for v in row if isinstance(v, str)).lower()
    if re.search(r"£\s*million", text):
        return 0.001
    if re.search(r"£\s*billion", text):
        return 1.0
    raise ValueError("unit (£ million / £ billion) not found in the table header")


def _kind(word: str) -> str | None:
    w = word.lower()
    if "outturn" in w and not re.search(r"estimat|forecast|plan|projection", w):
        return "outturn"
    if re.search(r"plan|forecast|projection|estimat", w):
        return "forecast"
    return None


def _columns(grid: list[list]) -> tuple[int, dict[int, str], dict[str, str]]:
    """Year row index, column -> period, and period -> kind (from the outturn/plans labels above or below)."""
    for i, row in enumerate(grid[:12]):
        cols = {j: normalise_fiscal_year(v) for j, v in enumerate(row) if isinstance(v, str) and normalise_fiscal_year(v)}
        if len(cols) >= 2:
            break
    else:
        raise ValueError("no row of fiscal years in the table header")
    kinds: dict[str, str] = {}
    for k in range(max(0, i - 2), min(len(grid), i + 3)):
        if k == i:
            continue
        labels = {j: _kind(v) for j, v in enumerate(grid[k]) if isinstance(v, str) and _kind(v)}
        if not labels:
            continue
        for j, p in cols.items():
            # A label covers its own column and those to its right (merged cells), until the next label.
            left = [c for c in labels if c <= j]
            if left and p not in kinds:
                kinds[p] = labels[max(left)]
    missing = [p for p in cols.values() if p not in kinds]
    if missing:
        raise ValueError(f"no outturn/plans label for {missing}")
    return i, cols, kinds


def _label_and_values(row: list, cols: dict[int, str], scale: float) -> tuple[str, dict[str, float]]:
    first = min(cols)
    label = next((v for v in row[:first] if isinstance(v, str) and v.strip()), "")
    values = {}
    for j, p in cols.items():
        x = _number(row[j]) if j < len(row) else None
        if x is not None:
            values[p] = round(x * scale, 6)
    return _clean(label), values


def _total_row(label: str) -> str | None:
    low = label.lower()
    if low == "public sector expenditure on services" or low.startswith("total expenditure on services"):
        return TES
    if low.startswith("accounting adjustments"):
        return ACCOUNTING
    if low.startswith("total managed expenditure"):
        return TME
    return None


def _function_header(label: str) -> str | None:
    m = re.match(r"^(\d{1,2})\.\s*\D", label)
    if m and not re.match(r"^\d{1,2}\.\d", label):
        return FUNCTIONS.get(int(m.group(1)))
    if label.lower().startswith("eu transactions"):
        return EU
    return None


def _slug(label: str, function: str) -> str:
    s = re.sub(r"^\d{1,2}\.\d{1,2}\s*", "", label)
    s = re.sub(r"^of which\s*:\s*", "", s, flags=re.I).strip()
    low = s.lower()
    if low in SLUG_OVERRIDES:
        return SLUG_OVERRIDES[low]
    if low.startswith("r&d"):
        return "r_and_d"
    fname = function.replace("_", " ")
    if low.endswith("n.e.c.") and (low[:-6].strip() in {fname, ""} or fname.startswith(low[:-6].strip()[:8])):
        return "nec"
    low = low.replace("n.e.c.", "nec").replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "_", low).strip("_")


def read_function_table(grid: list[list], name: str, title: str) -> Table:
    """PESA 4.2 / PSS Table 9: functions (£bn) with a few HMT 'of which' groupings."""
    yi, cols, kinds = _columns(grid)
    scale = _scale(grid, yi + 1)
    t = Table(name, title, list(cols.values()), kinds)
    for row in grid[yi + 1:]:
        label, values = _label_and_values(row, cols, scale)
        if not label or not values:
            continue
        total = _total_row(label)
        func = _function_header(label)
        if total:
            t.rows.append(Row(total, values, 0))
        elif func:
            t.rows.append(Row(f"spending.cofog.{func}", values, 1))
        elif re.search(r"public sector debt interest", label, re.I):
            parent = "spending.cofog.general_public_services"
            t.rows.append(Row(f"{parent}.{DEBT_INTEREST}", values, 2, parent))
        # Other 'of which' rows here are HMT groupings, not COFOG sub-functions: the sub-function table has those.
    return t


def read_subfunction_table(grid: list[list], name: str, title: str) -> Table:
    """PESA 5.2: every COFOG sub-function (£m), function totals, EU transactions, TES -> TME."""
    yi, cols, kinds = _columns(grid)
    scale = _scale(grid, yi + 1)
    t = Table(name, title, list(cols.values()), kinds)
    func: str | None = None
    sub: str | None = None
    for row in grid[yi + 1:]:
        label, values = _label_and_values(row, cols, scale)
        if not label:
            continue
        total = _total_row(label)
        if total:
            t.rows.append(Row(total, values, 0))
            func = sub = None
            continue
        header = _function_header(label)
        if header and not values:
            func, sub = header, None
            continue
        if func is None or not values:
            continue  # notes, "derived as:", empty headers
        fid = f"spending.cofog.{func}"
        low = label.lower()
        if low.startswith("total "):
            t.rows.append(Row(fid, values, 1))
            func = sub = None
            continue
        if func == EU:
            for pat, slug, parent in EU_ROWS:
                if re.search(pat, low):
                    pid = f"{fid}.{parent}" if parent else fid
                    t.rows.append(Row(f"{pid}.{slug}", values, 3 if parent else 2, pid))
                    break
            else:
                raise ValueError(f"{name}: unknown EU transactions row {label!r}")
            continue
        slug = _slug(label, func)
        if low.startswith("of which"):
            if sub is None:  # e.g. social protection's personal social services, across 10.1-10.7
                t.rows.append(Row(f"{fid}.{slug}", values, 2, fid, memo=True))
            else:
                pid = f"{fid}.{sub}"
                t.rows.append(Row(f"{pid}.{slug}", values, 3, pid))
            continue
        sub = slug
        t.rows.append(Row(f"{fid}.{slug}", values, 2, fid))
    return t


def read_aggregates_table(grid: list[list], name: str, title: str) -> Table:
    """PESA 4.1: TME (nominal £bn) by year, years down the rows; outturn up to the year in the header note."""
    tme_col = None
    for i, row in enumerate(grid[:10]):
        for j, v in enumerate(row):
            if isinstance(v, str) and v.lower().startswith("total managed expenditure"):
                tme_col = j
                # The first "Nominal ... £ billion" sub-column at or right of the group header.
                for k in range(i + 1, min(i + 3, len(grid))):
                    for c in range(j, len(grid[k])):
                        w = grid[k][c]
                        if isinstance(w, str) and "nominal" in w.lower():
                            if "£ billion" not in w.lower().replace("\n", " "):
                                raise ValueError(f"{name}: TME column is not in £ billion")
                            tme_col = c
                            break
                    else:
                        continue
                    break
                break
        if tme_col is not None:
            break
    if tme_col is None:
        raise ValueError(f"{name}: no Total Managed Expenditure column")
    head = " ".join(str(v) for row in grid[:5] for v in row if isinstance(v, str))
    m = re.search(r"outturn data in this table up to (\d{4}-\d{2})", head, re.I)
    if not m:
        raise ValueError(f"{name}: cannot tell outturn from plans (no 'Outturn data ... up to' note)")
    last_outturn = m.group(1)
    values, kinds = {}, {}
    for row in grid:
        lab = next((v for v in row[:3] if isinstance(v, str) and re.fullmatch(r"\s*\d{4}-\d{2}\s*", v)), None)
        p = normalise_fiscal_year(lab) if lab else None
        x = _number(row[tme_col]) if p and tme_col < len(row) else None
        if p and x is not None:
            values[p] = round(x, 6)
            kinds[p] = "outturn" if p <= last_outturn else "forecast"
    t = Table(name, title, list(values), kinds)
    t.rows.append(Row(TME, values, 0))
    return t


def read_workbook(path: Path) -> dict[str, Table]:
    """Find the function, sub-function and aggregates tables in a workbook by their titles."""
    found: dict[str, Table] = {}
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for ws in wb.worksheets:
            grid = _grid(ws)
            title = _title(grid)
            for key, rx, reader in (
                ("function", TITLE_FUNCTION, read_function_table),
                ("subfunction", TITLE_SUBFUNCTION, read_subfunction_table),
                ("aggregates", TITLE_AGGREGATES, read_aggregates_table),
            ):
                m = rx.match(title)
                if m and key not in found:
                    found[key] = reader(grid, f"Table {m.group(1)}", title)
    finally:
        wb.close()
    return found


def vintage_from_name(name: str) -> str | None:
    """Edition label from a file name, for raw files stored without one: PESA_2026_... / July_PSS_2026_... / PSS_May_2026_..."""
    if m := re.search(r"PESA_(\d{4})", name, re.I):
        return f"PESA-{m.group(1)}"
    m = re.search(r"([A-Za-z]+)_PSS_(\d{4})", name) or re.search(r"PSS_([A-Za-z]+)_(\d{4})", name)
    if m and m.group(1)[:3].lower() in _MONTHS:
        return f"PSS-{m.group(2)}-{_MONTHS[m.group(1)[:3].lower()]:02d}"
    return None


def editions(raws: list[RawArtifact]) -> list[Edition]:
    by_vintage: dict[str, Edition] = {}
    for raw in raws:
        if raw.path.suffix.lower() != ".xlsx":
            continue
        vintage = raw.vintage or vintage_from_name(raw.path.name) or "unknown"
        ed = by_vintage.setdefault(vintage, Edition(vintage))
        for key, table in read_workbook(raw.path).items():
            if getattr(ed, key) is None:
                setattr(ed, key, table)
    return [e for e in by_vintage.values() if e.function or e.subfunction]


def choose(eds: list[Edition]) -> Edition:
    if not eds:
        raise ValueError("no PESA/PSS function table among the raw files")
    return max(eds, key=Edition.order)


# ---------------------------------------------------------------------------
# parse: observations


def _label(vintage: str) -> str:
    m = re.match(r"(PESA|PSS)-(\d{4})(?:-(\d{2}))?", vintage)
    if not m:
        return vintage
    if m.group(1) == "PESA":
        return f"PESA {m.group(2)}"
    month = [k for k, v in _MONTHS.items() if v == int(m.group(3))][0].capitalize()
    return f"PSS {month} {m.group(2)}"


def parse(raws: list[RawArtifact]) -> list[Observation]:
    ed = choose(editions(raws))
    src = _label(ed.vintage)
    out: list[Observation] = []
    done: set[tuple[str, str]] = set()

    def emit(table: Table, row: Row, period: str, note: str):
        if (row.series_id, period) in done:
            return
        done.add((row.series_id, period))
        out.append(
            Observation(
                series_id=row.series_id,
                period=period,
                value=row.values[period],
                unit=UNIT,
                kind=table.kinds[period],
                source_id=SOURCE.id,
                vintage=ed.vintage,
                quality="sourced",
                method_note=(MEMO_NOTE + " " if row.memo else "") + note,
            )
        )

    # 1. Sub-function table (£m, most detail) for the years it covers.
    if ed.subfunction:
        t = ed.subfunction
        for row in t.rows:
            for p in t.periods:
                if p in row.values:
                    emit(t, row, p, f"{src} {t.name}, £ million / 1000.")
    # 2. Function table (£bn) for the earlier years.
    if ed.function:
        t = ed.function
        for row in t.rows:
            for p in t.periods:
                if p in row.values:
                    emit(t, row, p, f"{src} {t.name}.")
    # 3. Aggregates: TME for years outside the functional tables, incl. plan years.
    if ed.aggregates:
        t = ed.aggregates
        for row in t.rows:
            for p in t.periods:
                kind_note = " Plan year: not yet outturn." if t.kinds[p] == "forecast" else ""
                emit(t, row, p, f"{src} {t.name}, nominal TME.{kind_note}")
    return out
