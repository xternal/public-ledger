"""
ETL core: the contract every source module follows (docs/DATA_SOURCES.md "ETL contract").

A source module in etl/sources/<id>.py exposes:

    SOURCE: Source
    def fetch(since: date | None = None) -> list[RawArtifact]   # download and store raw files with hashes
    def parse(raws: list[RawArtifact]) -> list[Observation]     # normalise to Observation

Raw files live in data/raw/<source_id>/ (gitignored); data/build/manifest.json
records each file's URL, sha256 and fetch time so a build can be audited.

Conventions (shared by every module, the build and the app):

    period     "2025-26" fiscal year, "2026-08" month, "2026-09-18" date
    unit       gbp_bn, pct, pct_gdp, rate_pct, persons_m, households_m, gbp
    kind       outturn | forecast | projection
    quality    sourced | approx | modelled | training   (method_note required unless sourced)
    series_id  dotted, lower_snake segments; see SERIES below
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx
from pydantic import BaseModel, model_validator

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
BUILD_DIR = ROOT / "data" / "build"
USER_AGENT = "PublicLedgerETL/0.1 (+https://github.com/xternal/public-ledger)"

Quality = Literal["sourced", "approx", "modelled", "training"]
Kind = Literal["outturn", "forecast", "projection"]

FISCAL_YEAR = re.compile(r"^\d{4}-\d{2}$")
MONTH = re.compile(r"^\d{4}-\d{2}$")

# Series ids the build relies on. Modules may emit more (e.g. receipts.detail.*),
# but these names must be used exactly when a module produces them.
SERIES = {
    # OBR fiscal aggregates, fiscal years, £bn unless noted
    "receipts.total": "Public sector current receipts (PSCR)",
    "spending.tme": "Total managed expenditure",
    "spending.debt_interest": "Central government debt interest, net of APF, as used in TME",
    "fiscal.psnb": "Public sector net borrowing",
    "fiscal.psnd": "Public sector net debt (end of year)",
    "fiscal.psnd_pct_gdp": "PSND as % of GDP (pct_gdp)",
    "macro.nominal_gdp": "Nominal GDP, fiscal year (£bn)",
    # Receipts lines used by the Statement (fiscal years, £bn)
    "receipts.income_tax": "Income tax (gross of tax credits, as OBR reports)",
    "receipts.nics": "National insurance contributions",
    "receipts.vat": "VAT",
    "receipts.corp_tax": "Onshore + offshore corporation tax",
    "receipts.council_tax": "Council tax",
    "receipts.business_rates": "Business rates (national non-domestic rates)",
    "receipts.fuel_duty": "Fuel duties",
    "receipts.stamp_duty": "Stamp duties (land and shares)",
    "receipts.cgt": "Capital gains tax",
    "receipts.alcohol_tobacco": "Alcohol and tobacco duties",
    "receipts.iht": "Inheritance tax",
    "receipts.other_taxes": "All other taxes (sum of the remaining tax lines)",
    "receipts.non_tax": "Non-tax receipts (interest, dividends, operating surplus, etc.)",
    # HMT PESA, COFOG functions (fiscal years, £bn, total expenditure on services)
    "spending.tes.total": "Total expenditure on services",
    "spending.cofog.general_public_services": "COFOG 1, including debt interest",
    "spending.cofog.general_public_services.debt_interest": "COFOG 1 sub-function: public sector debt interest",
    "spending.cofog.defence": "COFOG 2",
    "spending.cofog.public_order": "COFOG 3",
    "spending.cofog.economic_affairs": "COFOG 4",
    "spending.cofog.environment_protection": "COFOG 5",
    "spending.cofog.housing_amenities": "COFOG 6",
    "spending.cofog.health": "COFOG 7",
    "spending.cofog.recreation_culture": "COFOG 8",
    "spending.cofog.education": "COFOG 9",
    "spending.cofog.social_protection": "COFOG 10",
    "spending.accounting_adjustments": "TME minus TES (PESA reconciliation)",
    # Rates and people
    "macro.bank_rate": "Bank Rate (rate_pct), period = decision/effective date",
    "people.households": "UK households (households_m)",
    "people.population": "UK population mid-year estimate (persons_m)",
    "people.income_taxpayers": "Individual income taxpayers (persons_m)",
}


class Source(BaseModel):
    id: str
    title: str
    publisher: str
    url: str
    licence: str | None = "OGL v3"
    published_on: date | None = None
    # How often a new edition is expected, and how late it may be before CI fails.
    cadence_days: int
    grace_days: int = 14


class Observation(BaseModel):
    series_id: str
    period: str
    geography: str = "UK"
    value: float
    unit: str
    kind: Kind
    source_id: str
    vintage: str
    quality: Quality
    method_note: str | None = None

    @model_validator(mode="after")
    def _rules(self) -> "Observation":
        if self.quality != "sourced" and not self.method_note:
            raise ValueError(f"{self.series_id} {self.period}: quality {self.quality} needs a method_note")
        if not re.fullmatch(r"[a-z0-9_]+(\.[a-z0-9_]+)*", self.series_id):
            raise ValueError(f"bad series_id {self.series_id!r}")
        return self


@dataclass
class RawArtifact:
    source_id: str
    url: str
    path: Path
    sha256: str
    fetched_at: str
    content_type: str | None = None
    # Free-form edition label found while fetching (e.g. "EFO-2026-03"), if any.
    vintage: str | None = None

    def to_manifest(self) -> dict:
        d = asdict(self)
        d["path"] = str(self.path.relative_to(ROOT))
        return d


def client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=httpx.Timeout(90.0, connect=20.0),
    )


def _safe_name(url: str) -> str:
    name = Path(urlparse(url).path).name or "index.html"
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def download(
    source_id: str,
    url: str,
    filename: str | None = None,
    *,
    max_age: timedelta = timedelta(hours=20),
    vintage: str | None = None,
    http: httpx.Client | None = None,
) -> RawArtifact:
    """
    Download a URL into data/raw/<source_id>/ and record its hash. A file
    fetched less than `max_age` ago is reused, so development runs do not hit
    the publisher again (be polite: one request per file per day).
    """
    folder = RAW_DIR / source_id
    folder.mkdir(parents=True, exist_ok=True)
    name = filename or _safe_name(url)
    path = folder / name
    meta_path = folder / f"{name}.meta.json"
    if path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        fetched = datetime.fromisoformat(meta["fetched_at"])
        # Publishers redirect (OBR /download/... -> /docs/...): match the URL we asked for too.
        if url in (meta.get("url"), meta.get("requested_url")) and datetime.now(timezone.utc) - fetched < max_age:
            return RawArtifact(source_id, url, path, meta["sha256"], meta["fetched_at"], meta.get("content_type"), meta.get("vintage") or vintage)
    own = http is None
    http = http or client()
    try:
        r = http.get(url)
        r.raise_for_status()
    finally:
        if own:
            http.close()
    path.write_bytes(r.content)
    sha = hashlib.sha256(r.content).hexdigest()
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta = {"url": str(r.url), "requested_url": url, "sha256": sha, "fetched_at": fetched_at, "content_type": r.headers.get("content-type"), "vintage": vintage}
    meta_path.write_text(json.dumps(meta, indent=2))
    return RawArtifact(source_id, url, path, sha, fetched_at, meta["content_type"], vintage)


def links(html: str, base: str, pattern: str) -> list[str]:
    """Absolute hrefs in an HTML page that match a regex, in page order, without duplicates."""
    from bs4 import BeautifulSoup

    seen: list[str] = []
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        href = urljoin(base, a["href"])
        if re.search(pattern, href, re.I) and href not in seen:
            seen.append(href)
    return seen


def fiscal_year(start_year: int) -> str:
    """2025 -> "2025-26"."""
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def normalise_fiscal_year(label: str) -> str | None:
    """Accept "2025-26", "2025/26", "2025-2026", "2025–26"; return "2025-26" or None."""
    m = re.search(r"(\d{4})\s*[-/–]\s*(\d{2,4})", str(label))
    if not m:
        return None
    start = int(m.group(1))
    end = int(m.group(2)[-2:])
    if (start + 1) % 100 != end:
        return None
    return fiscal_year(start)


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False) + "\n")
