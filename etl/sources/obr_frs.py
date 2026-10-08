"""
OBR Fiscal risks and sustainability (FRS): long-term spending projections to 2075-76.

Discovery (fetch): https://obr.uk/frs/ links every edition page
("/frs/fiscal-risks-and-sustainability-<month>-<year>/"); the newest is used, and its
"charts and tables: Chapter 3" workbook (long-term spending projections) is
downloaded. If discovery fails, the July 2026 edition is used and a warning is
logged. OBR refuses GitHub's servers, so every request may go through the Internet
Archive (core.download(archive=True)).

Tables used, found by their title (not sheet position) and read by row label and
fiscal-year header:

  Table 3.1  Baseline primary spending scenario, % of GDP, at the years OBR shows
             (2025-26, 2030-31, then every ten years to 2075-76): health, adult
             social care, education, state pension, other welfare, public service
             pensions and total age-related spending   -> frs.age_related.<line>
  Chart 3.12 Primary spending under alternative policy and demographic
             assumptions, % of GDP, every year           -> frs.primary.<scenario>
  Chart 3.4  Health spending under alternative population health assumptions,
             % of GDP, every year                        -> frs.health.<scenario>

The first year is OBR's estimate consistent with the latest EFO, the next five are
the EFO's medium-term forecast (kind "forecast"); later years are projections.
A missing table, row or year raises, so the build keeps the committed edition.
"""

from __future__ import annotations

import calendar
import logging
import re
from dataclasses import dataclass
from datetime import date
from html import unescape
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import httpx
import openpyxl

from etl.core import Observation, RawArtifact, Source, download, links, normalise_fiscal_year

log = logging.getLogger(__name__)

INDEX_URL = "https://obr.uk/frs/"
FALLBACK_URL = "https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/"
MAX_EDITION_PAGES = 2

SOURCE = Source(
    id="obr_frs",
    title="OBR Fiscal risks and sustainability – July 2026",
    publisher="Office for Budget Responsibility",
    url=FALLBACK_URL,
    licence="OGL v3",
    published_on=date(2026, 7, 7),
    # Once a year, usually July (September in 2024).
    cadence_days=365,
    grace_days=90,
)

SPENDING_WORKBOOK = r"/download/[^/?#]*charts-and-tables-chapter-3/"
EFO_HORIZON_YEARS = 5

# Table 3.1 row label (footnote digits removed, lower case) -> series line.
AGE_RELATED = {
    "health": "health",
    "adult social care": "adult_social_care",
    "education": "education",
    "state pension": "state_pension",
    "other welfare benefits": "other_welfare",
    "public service pensions": "public_service_pensions",
    "total age-related spending": "total",
}
TABLES = {
    "age_related": r"baseline primary spending scenario",
    "primary": r"primary spending under alternative policy and demographic assumptions",
    "health": r"health spending under alternative population health assumptions",
}

_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
_EDITION_PATH = re.compile(r"^/frs/fiscal-risks-and-sustainability-([a-z]+)-(\d{4})/?$")
_FILE = re.compile(r"^frs_(\d{4})_(\d{2})_chapter3\.xlsx$")


@dataclass
class Edition:
    url: str
    year: int
    month: int
    title: str
    published_on: date | None
    workbook: str

    @property
    def vintage(self) -> str:
        return f"FRS-{self.year}-{self.month:02d}"


EDITION: Edition | None = None  # set by fetch()


def _strip_query(url: str) -> str:
    return urlunparse(urlparse(url)._replace(query="", fragment=""))


def edition_of(url: str) -> tuple[int, int] | None:
    """'https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/' -> (2026, 7)."""
    u = urlparse(url)
    if u.netloc and u.netloc not in ("obr.uk", "www.obr.uk"):
        return None
    m = _EDITION_PATH.match(u.path)
    if not m or m.group(1) not in _MONTHS:
        return None
    return int(m.group(2)), _MONTHS[m.group(1)]


def edition_candidates(html: str, base: str = INDEX_URL) -> list[str]:
    """Edition page URLs named on a page, newest first."""
    found: dict[str, tuple[int, int]] = {}
    for u in links(html, base, r"/frs/fiscal-risks-and-sustainability-[a-z]+-\d{4}"):
        u = _strip_query(u)
        u = u if u.endswith("/") else u + "/"
        if (ym := edition_of(u)) and u not in found:
            found[u] = ym
    return sorted(found, key=lambda u: found[u], reverse=True)


def page_title(html: str) -> str | None:
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html) or re.search(r"<title>([^<]+)</title>", html)
    if not m:
        return None
    t = re.sub(r"\s+[-|–]\s+Office for Budget Responsibility\s*$", "", unescape(m.group(1))).strip()
    return f"OBR {t}"


def page_published_on(html: str) -> date | None:
    m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', html) or re.search(
        r'<meta[^>]+property="article:published_time"[^>]+content="(\d{4}-\d{2}-\d{2})', html
    )
    return date.fromisoformat(m.group(1)) if m else None


def edition_from_page(url: str, html: str) -> Edition:
    ym = edition_of(url)
    if ym is None:
        raise LookupError(f"{url} is not an FRS edition page")
    year, month = ym
    found = [_strip_query(u) for u in links(html, url, SPENDING_WORKBOOK)]
    if not found:
        raise LookupError(f"{url}: no chapter 3 charts-and-tables workbook")
    tag = f"{calendar.month_name[month].lower()}-{year}"
    own = [u for u in found if tag in u]
    title = page_title(html) or f"OBR Fiscal risks and sustainability – {calendar.month_name[month]} {year}"
    return Edition(url, year, month, title, page_published_on(html), (own or found)[0])


def _page(url: str, filename: str) -> str:
    return download(SOURCE.id, url, filename, archive=True).path.read_text(errors="replace")


def discover() -> Edition:
    try:
        index = _page(INDEX_URL, "frs_index.html")
        candidates = edition_candidates(index)
        if not candidates:
            raise LookupError(f"no FRS edition links on {INDEX_URL}")
        for url in candidates[:MAX_EDITION_PAGES]:
            try:
                y, m = edition_of(url)
                return edition_from_page(url, _page(url, f"frs_{y}_{m:02d}_landing.html"))
            except (LookupError, httpx.HTTPError) as e:
                log.warning("obr_frs: skipping %s: %s", url, e)
        raise LookupError(f"none of {candidates[:MAX_EDITION_PAGES]} links a chapter 3 workbook")
    except (LookupError, httpx.HTTPError, OSError) as e:
        log.warning("obr_frs: discovery failed (%s); falling back to %s", e, FALLBACK_URL)
    return edition_from_page(FALLBACK_URL, _page(FALLBACK_URL, "frs_2026_07_landing.html"))


def fetch(since: date | None = None) -> list[RawArtifact]:
    global EDITION
    ed = discover()
    EDITION = ed
    SOURCE.url, SOURCE.title, SOURCE.published_on = ed.url, ed.title, ed.published_on
    log.info("obr_frs: using %s (%s, published %s) from %s", ed.vintage, ed.title, ed.published_on, ed.url)
    return [download(SOURCE.id, ed.workbook, f"frs_{ed.year}_{ed.month:02d}_chapter3.xlsx", vintage=ed.vintage, archive=True)]


# --------------------------------------------------------------------------- parsing


def _label(v) -> str:
    """'Education2' -> 'education'; footnote digits and spacing removed, lower case."""
    return re.sub(r"\d+\s*$", "", str(v)).strip().lower() if v is not None else ""


def slug(label: str) -> str:
    known = {
        "baseline": "baseline",
        "cpi uprating of non-state pension welfare": "cpi_uprating_welfare",
        "earnings uprating of the state pension": "earnings_uprating_state_pension",
        "higher population": "higher_population",
        "no extra cost pressures in health spending": "no_extra_health_cost_pressures",
        "lower healthy life expectancy": "lower_healthy_life_expectancy",
        "higher healthy life expectancy": "higher_healthy_life_expectancy",
    }
    return known.get(label) or re.sub(r"[^a-z0-9]+", "_", label).strip("_")


def sheet_titles(wb) -> dict[str, str]:
    """{lower-case title without the 'Table 3.1:' prefix: sheet name}."""
    out = {}
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=1, max_row=4, values_only=True):
            t = next((v for v in row if isinstance(v, str) and re.match(r"^(Table|Chart) [\dA-Z]+\.[\dA-Z]+:", v.strip())), None)
            if t:
                out[re.sub(r"^(Table|Chart) [\dA-Z]+\.[\dA-Z]+:\s*", "", t.strip()).strip().lower()] = ws.title
                break
    return out


def read_rows(ws) -> dict[str, dict[str, float]]:
    """{row label: {fiscal year: value}} under the first header row that names at least three fiscal years."""
    years: dict[int, str] | None = None
    rows: dict[str, dict[str, float]] = {}
    for row in ws.iter_rows(values_only=True):
        if years is None:
            fy = {i: normalise_fiscal_year(v) for i, v in enumerate(row) if isinstance(v, str)}
            fy = {i: y for i, y in fy.items() if y}
            if len(fy) >= 3:
                years = fy
            continue
        label = next((v for v in row if isinstance(v, str) and v.strip()), None)
        if label is None:
            continue
        vals = {years[i]: float(v) for i, v in enumerate(row) if i in years and isinstance(v, (int, float))}
        if vals and _label(label) not in rows:
            rows[_label(label)] = vals
    if years is None:
        raise ValueError(f"{ws.title}: no fiscal-year header row")
    return rows


def edition_from_file(path: Path) -> tuple[int, int]:
    m = _FILE.match(path.name)
    if not m:
        raise ValueError(f"unexpected file name {path.name}; expected frs_<year>_<month>_chapter3.xlsx")
    return int(m.group(1)), int(m.group(2))


def read_workbook(path: Path) -> dict[str, dict[str, dict[str, float]]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    titles = sheet_titles(wb)
    out = {}
    for key, pattern in TABLES.items():
        name = next((s for t, s in titles.items() if re.fullmatch(pattern, t)), None)
        if name is None:
            raise ValueError(f"{path.name}: no table titled like {pattern!r} (found: {sorted(titles)})")
        out[key] = read_rows(wb[name])
    return out


def kind_of(year: str, first: str) -> str:
    return "forecast" if int(year[:4]) - int(first[:4]) <= EFO_HORIZON_YEARS else "projection"


def parse(raws: list[RawArtifact]) -> list[Observation]:
    raw = raws[0] if isinstance(raws, list) else raws
    y, m = edition_from_file(raw.path)
    vintage = raw.vintage or f"FRS-{y}-{m:02d}"
    tables = read_workbook(raw.path)
    out: list[Observation] = []

    age = tables["age_related"]
    missing = [label for label in AGE_RELATED if label not in age]
    if missing:
        raise ValueError(f"{raw.path.name}: Table 3.1 has no row(s) {missing}")
    first = min(age["total age-related spending"])
    for label, line in AGE_RELATED.items():
        for fy, v in sorted(age[label].items()):
            out.append(Observation(series_id=f"frs.age_related.{line}", period=fy, value=v, unit="pct_gdp", kind=kind_of(fy, first),
                                   source_id=SOURCE.id, vintage=vintage, quality="sourced"))

    for key in ("primary", "health"):
        rows = tables[key]
        if "baseline" not in rows:
            raise ValueError(f"{raw.path.name}: the {key} scenarios have no Baseline row")
        for label, series in rows.items():
            for fy, v in sorted(series.items()):
                out.append(Observation(series_id=f"frs.{key}.{slug(label)}", period=fy, value=v, unit="pct_gdp", kind=kind_of(fy, first),
                                       source_id=SOURCE.id, vintage=vintage, quality="sourced"))

    # Table 3.1's years must appear in the annual scenarios, or the scenario totals cannot be worked out.
    years = set(age["total age-related spending"])
    for key in ("primary", "health"):
        absent = years - set(tables[key]["baseline"])
        if absent:
            raise ValueError(f"{raw.path.name}: {key} scenarios lack {sorted(absent)}")
    return out
