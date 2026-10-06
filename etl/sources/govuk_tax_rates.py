"""
Income tax and employee National Insurance rates and thresholds (England, Wales
and Northern Ireland) from GOV.UK, read through the GOV.UK content API.

Documents (JSON from https://www.gov.uk/api/content/<path>):
  income-tax-rates                   current tax year + "Previous tax years" part
  national-insurance-rates-letters   current-year employee rates, weekly thresholds
  guidance/rates-and-thresholds-for-employers-YYYY-to-YYYY
                                     HMRC: annual NI thresholds, Class 1 rates, PAYE bands,
                                     one per tax year found on income-tax-rates

Income tax comes from income-tax-rates and is cross-checked against the HMRC
PAYE table (England and Northern Ireland). NI comes from the HMRC guidance
(the GOV.UK NI page only gives weekly and monthly thresholds) and is
cross-checked against the NI page for the current year. Any pattern that is
not found, or any disagreement between documents, raises ValueError: nothing
is guessed.

Series (period = tax year "YYYY-YY"; gbp = £ a year; pct = 20.0 for 20%):
  tax.income_tax.personal_allowance, basic_rate, basic_band (width above the
  allowance), higher_rate, additional_threshold, additional_rate,
  allowance_taper_threshold; tax.ni.primary_threshold, upper_earnings_limit,
  main_rate, upper_rate (employee, category A).
"""

from __future__ import annotations

import json
import re
from datetime import date

from bs4 import BeautifulSoup

from etl.core import Observation, RawArtifact, Source, download, fiscal_year

SOURCE_ID = "govuk_tax_rates"
GEOGRAPHY = "England, Wales and NI"
API = "https://www.gov.uk/api/content"
INCOME_TAX_PATH = "income-tax-rates"
NI_PATH = "national-insurance-rates-letters"
HMRC_PATH = "guidance/rates-and-thresholds-for-employers-{start}-to-{end}"

SOURCE = Source(
    id=SOURCE_ID,
    title="Income Tax rates and Personal Allowances; National Insurance rates; HMRC rates and thresholds for employers",
    publisher="GOV.UK / HM Revenue and Customs",
    url="https://www.gov.uk/income-tax-rates",
    cadence_days=365,
    grace_days=60,
)

UNITS = {
    "personal_allowance": "gbp", "basic_band": "gbp", "additional_threshold": "gbp",
    "allowance_taper_threshold": "gbp", "primary_threshold": "gbp", "upper_earnings_limit": "gbp",
    "basic_rate": "pct", "higher_rate": "pct", "additional_rate": "pct", "main_rate": "pct", "upper_rate": "pct",
}
INCOME_TAX_KEYS = ["personal_allowance", "basic_rate", "basic_band", "higher_rate",
                   "additional_threshold", "additional_rate", "allowance_taper_threshold"]
NI_KEYS = ["primary_threshold", "upper_earnings_limit", "main_rate", "upper_rate"]


# ---------------------------------------------------------------- helpers

def _norm(s: str) -> str:
    return " ".join(s.replace("\xa0", " ").split())


def _need(pattern: str, text: str, what: str) -> re.Match:
    m = re.search(pattern, text, re.I)
    if not m:
        raise ValueError(f"{SOURCE_ID}: {what}: pattern {pattern!r} not found")
    return m


def _gbp(s: str) -> float:
    return float(s.replace(",", ""))


def _pct(cell: str, what: str) -> float:
    return float(_need(r"^(\d+(?:\.\d+)?)%$", cell, what).group(1))


def _year(m: re.Match) -> str:
    start, end = int(m.group(1)), int(m.group(2))
    if end != start + 1:
        raise ValueError(f"{SOURCE_ID}: tax year {start} to {end} is not one year")
    return fiscal_year(start)


def _rows(table) -> list[list[str]]:
    return [[_norm(c.get_text(" ")) for c in tr.find_all(["td", "th"])] for tr in table.find_all("tr")]


def _row(rows: list[list[str]], label: str, what: str) -> list[str]:
    found = [r for r in rows if r and re.match(label, r[0], re.I)]
    if len(found) != 1:
        raise ValueError(f"{SOURCE_ID}: {what}: expected one row starting {label!r}, found {len(found)}")
    return found[0]


def _heading(soup, text: str, what: str):
    found = [h for h in soup.find_all(["h2", "h3"]) if _norm(h.get_text(" ")).lower() == text.lower()]
    if len(found) != 1:
        raise ValueError(f"{SOURCE_ID}: {what}: expected one heading {text!r}, found {len(found)}")
    return found[0]


def _table_after(soup, heading: str, what: str):
    """The first table under a heading (no other heading in between)."""
    h = _heading(soup, heading, what)
    t = h.find_next("table")
    if t is None or t.find_previous(["h2", "h3"]) is not h:
        raise ValueError(f"{SOURCE_ID}: {what}: no table directly under {heading!r}")
    return t


def _table(soup, must_contain: str, what: str):
    tables = [t for t in soup.find_all("table") if must_contain.lower() in _norm(t.get_text(" ")).lower()]
    if not tables:
        raise ValueError(f"{SOURCE_ID}: {what}: no table containing {must_contain!r}")
    return tables[0]


def _doc(raw: RawArtifact) -> dict:
    doc = json.loads(raw.path.read_text(encoding="utf-8"))
    if "details" not in doc:
        raise ValueError(f"{SOURCE_ID}: {raw.url} is not a content API document")
    return doc


def _html(body) -> str:
    """A body is HTML, or a list of {content_type, content} alternatives."""
    if isinstance(body, list):
        body = next((b["content"] for b in body if b.get("content_type") == "text/html"), None)
    if not isinstance(body, str):
        raise ValueError(f"{SOURCE_ID}: document body has no HTML")
    return body


def _part(doc: dict, slug: str) -> BeautifulSoup:
    parts = {p.get("slug"): p for p in doc["details"].get("parts", [])}
    if slug not in parts:
        raise ValueError(f"{SOURCE_ID}: {doc.get('base_path')}: no part {slug!r} (has {sorted(parts)})")
    return BeautifulSoup(_html(parts[slug]["body"]), "html.parser")


def _vintage(doc: dict) -> str:
    return f"{doc['base_path'].rsplit('/', 1)[-1]}@{doc['updated_at'][:10]}"


def _bands(pa: float, basic_upper: float, higher_lower: float, higher_upper: float, over: float, what: str) -> dict:
    """Turn gross band edges into the series values, checking the edges join up."""
    if higher_lower != basic_upper + 1:
        raise ValueError(f"{SOURCE_ID}: {what}: higher band starts at {higher_lower}, basic ends at {basic_upper}")
    # GOV.UK prints "Over £125,141" for 2025-26 and "over £125,140" for 2026-27: accept either.
    if over not in (higher_upper, higher_upper + 1):
        raise ValueError(f"{SOURCE_ID}: {what}: additional rate starts over {over}, higher band ends at {higher_upper}")
    return {"basic_band": basic_upper - pa, "additional_threshold": higher_upper}


# ---------------------------------------------------------------- income-tax-rates

def _income_tax_current(doc: dict) -> tuple[str, dict]:
    soup = _part(doc, "current-rates-and-allowances")
    text = _norm(soup.get_text(" "))
    what = "income-tax-rates current year"
    year = _year(_need(r"current tax year is from 6 April (\d{4}) to 5 April (\d{4})", text, what))
    pa = _gbp(_need(r"standard Personal Allowance is £([\d,]+)", text, what).group(1))
    taper = _gbp(_need(r"goes down by £1 for every £2 that your adjusted net income is above £([\d,]+)", text, what).group(1))
    rows = _rows(_table_after(soup, "Income Tax rates and bands", what))
    pa_row = _row(rows, r"Personal Allowance$", what)
    if _gbp(_need(r"^Up to £([\d,]+)$", pa_row[1], what).group(1)) != pa or _pct(pa_row[2], what) != 0:
        raise ValueError(f"{SOURCE_ID}: {what}: Personal Allowance row {pa_row} disagrees with £{pa:,.0f}")
    basic, higher, add = (_row(rows, label, what) for label in (r"Basic rate$", r"Higher rate$", r"Additional rate$"))
    b = _need(r"^£([\d,]+) to £([\d,]+)$", basic[1], what)
    h = _need(r"^£([\d,]+) to £([\d,]+)$", higher[1], what)
    over = _gbp(_need(r"^over £([\d,]+)$", add[1], what).group(1))
    if _gbp(b.group(1)) != pa + 1:
        raise ValueError(f"{SOURCE_ID}: {what}: basic band starts at £{b.group(1)}, not allowance + 1")
    vals = {
        "personal_allowance": pa, "allowance_taper_threshold": taper,
        "basic_rate": _pct(basic[2], what), "higher_rate": _pct(higher[2], what), "additional_rate": _pct(add[2], what),
        **_bands(pa, _gbp(b.group(2)), _gbp(h.group(1)), _gbp(h.group(2)), over, what),
    }
    return year, vals


def _income_tax_previous(doc: dict) -> tuple[str, dict]:
    soup = _part(doc, "previous-tax-years")
    text = _norm(soup.get_text(" "))
    what = "income-tax-rates previous year"
    m = _need(r"standard Personal Allowance from 6 April (\d{4}) to 5 April (\d{4}) was £([\d,]+)", text, what)
    year, pa = _year(m), _gbp(m.group(3))
    taper = _gbp(_need(r"Personal Allowance would have been smaller if your income was over £([\d,]+)", text, what).group(1))
    rows = _rows(_table(soup, "Taxable income above your Personal Allowance", what))
    basic, higher, add = (_row(rows, label, what) for label in (r"Basic rate \d", r"Higher rate \d", r"Additional rate \d"))
    rate = lambda row: float(_need(r"(\d+(?:\.\d+)?)%$", row[0], what).group(1))  # noqa: E731
    # Cells read "£0 to £50,270 (people with the standard Personal Allowance started paying this
    # rate on income over £12,570)": the band edges are gross income, as the brackets show.
    b = _need(r"^£0 to £([\d,]+) \(people with the standard Personal Allowance started paying this rate on income over £([\d,]+)\)$", basic[1], what)
    h = _need(r"^£([\d,]+) to £([\d,]+) \(people with the standard Personal Allowance started paying this rate on income over £([\d,]+)\)$", higher[1], what)
    over = _gbp(_need(r"^over £([\d,]+)$", add[1], what).group(1))
    if _gbp(b.group(2)) != pa or _gbp(h.group(3)) != _gbp(b.group(1)):
        raise ValueError(f"{SOURCE_ID}: {what}: band notes {basic[1]!r} / {higher[1]!r} do not match the allowance")
    vals = {
        "personal_allowance": pa, "allowance_taper_threshold": taper,
        "basic_rate": rate(basic), "higher_rate": rate(higher), "additional_rate": rate(add),
        **_bands(pa, _gbp(b.group(1)), _gbp(h.group(1)), _gbp(h.group(2)), over, what),
    }
    return year, vals


# ---------------------------------------------------------------- HMRC rates and thresholds for employers

def _paye(soup, heading: str, year: str, what: str) -> dict:
    """PAYE allowance and bands under one country heading of the HMRC guidance."""
    what = f"{what} ({heading})"
    head = _heading(soup, heading, what)
    nxt = _table_after(soup, heading, what)
    between = []
    for el in head.next_elements:
        if el is nxt:
            break
        if isinstance(el, str):
            between.append(el)
    m = _need(r"personal allowance for the (\d{4}) to (\d{4}) tax year is: .*?£([\d,]+) per year", _norm(" ".join(between)), what)
    if _year(m) != year:
        raise ValueError(f"{SOURCE_ID}: {what}: personal allowance is for {_year(m)}, page is for {year}")
    pa = _gbp(m.group(3))
    rows = _rows(nxt)
    basic, higher, add = (_row(rows, label, what) for label in (r"Basic tax rate$", r"Higher tax rate$", r"Additional tax rate$"))
    b = _gbp(_need(r"^Up to £([\d,]+)$", basic[2], what).group(1))
    h = _need(r"^From £([\d,]+) to £([\d,]+)$", higher[2], what)
    over = _gbp(_need(r"^Above £([\d,]+)$", add[2], what).group(1))
    if _gbp(h.group(1)) != b + 1 or over != _gbp(h.group(2)):
        raise ValueError(f"{SOURCE_ID}: {what}: PAYE bands {basic} / {higher} / {add} do not join up")
    return {
        "personal_allowance": pa, "basic_rate": _pct(basic[1], what), "basic_band": b,
        "higher_rate": _pct(higher[1], what), "additional_threshold": over, "additional_rate": _pct(add[1], what),
    }


def _hmrc(doc: dict) -> tuple[str, dict, dict]:
    """Return (year, income tax values for England and NI, NI values). Wales must match England and NI."""
    soup = BeautifulSoup(_html(doc["details"]["body"]), "html.parser")
    text = _norm(soup.get_text(" "))
    what = doc["base_path"]
    year = _year(_need(r"figures apply from 6 April (\d{4}) to 5 April (\d{4})", text, what))
    it = _paye(soup, "England and Northern Ireland", year, what)
    _check(year, it, _paye(soup, "Wales", year, what), it.keys(), f"{what}: Wales and England and NI PAYE bands")

    th = _rows(_table_after(soup, "Class 1 National Insurance thresholds", what))
    if year != fiscal_year(int(_need(r"^(\d{4}) to \d{4}$", th[0][-1], what).group(1))):
        raise ValueError(f"{SOURCE_ID}: {what}: NI thresholds table is headed {th[0]}")
    per = lambda label: _need(r"£([\d,]+) per week .*?£([\d,]+) per year$", _row(th, label, what)[1], what)  # noqa: E731
    pt, uel = per(r"Primary threshold$"), per(r"Upper earnings limit$")
    rates = _rows(_table_after(soup, "Employee (primary) contribution rates", what))
    if "above primary threshold" not in rates[0][2].lower() or "above upper earnings limit" not in rates[0][3].lower():
        raise ValueError(f"{SOURCE_ID}: {what}: employee rates columns are {rates[0]}")
    a = _row(rates, r"A$", what)
    if len(a) != 4:
        raise ValueError(f"{SOURCE_ID}: {what}: employee category A row {a} is not 4 cells")
    ni = {
        "primary_threshold": _gbp(pt.group(2)), "upper_earnings_limit": _gbp(uel.group(2)),
        "main_rate": _pct(a[2], what), "upper_rate": _pct(a[3], what),
        "_weekly": (_gbp(pt.group(1)), _gbp(uel.group(1))),
    }
    return year, it, ni


def _ni_page(doc: dict) -> tuple[str, dict]:
    """Current-year employee rates (category A) and weekly thresholds from national-insurance-rates-letters."""
    soup = _part(doc, "contribution-rates")
    text = _norm(soup.get_text(" "))
    what = "national-insurance-rates-letters"
    year = _year(_need(r"deduct from employees.? pay from 6 April (\d{4}) to 5 April (\d{4})", text, what))
    rows = _rows(_table_after(soup, "Employee National Insurance rates", what))
    header, a = rows[0], _row(rows[1:], r"A$", what)
    pt = _gbp(_need(r"^£[\d,.]+ to £([\d,]+) \(", header[1], what).group(1))
    uel = _gbp(_need(r"^Over £([\d,]+) a week", header[3], what).group(1))
    return year, {"main_rate": _pct(a[2], what), "upper_rate": _pct(a[3], what), "_weekly": (pt, uel)}


# ---------------------------------------------------------------- contract

def _url(path: str) -> str:
    return f"{API}/{path}"


def _filename(path: str) -> str:
    return path.rsplit("/", 1)[-1] + ".json"


def fetch(since: date | None = None) -> list[RawArtifact]:
    it = download(SOURCE_ID, _url(INCOME_TAX_PATH), _filename(INCOME_TAX_PATH))
    ni = download(SOURCE_ID, _url(NI_PATH), _filename(NI_PATH))
    doc = _doc(it)
    years = [_income_tax_current(doc)[0], _income_tax_previous(doc)[0]]
    out = [it, ni]
    for y in years:
        start = int(y[:4])
        path = HMRC_PATH.format(start=start, end=start + 1)
        out.append(download(SOURCE_ID, _url(path), _filename(path)))
    return out


def _check(year: str, a: dict, b: dict, keys, what: str) -> None:
    bad = {k: (a[k], b[k]) for k in keys if a[k] != b[k]}
    if bad:
        raise ValueError(f"{SOURCE_ID}: {year}: {what} disagree: {bad}")


def parse(raws: list[RawArtifact]) -> list[Observation]:
    docs = [_doc(r) for r in raws]
    by_path = {d["base_path"].lstrip("/"): d for d in docs}
    if INCOME_TAX_PATH not in by_path or NI_PATH not in by_path:
        raise ValueError(f"{SOURCE_ID}: need {INCOME_TAX_PATH} and {NI_PATH}, got {sorted(by_path)}")
    it_doc, ni_doc = by_path[INCOME_TAX_PATH], by_path[NI_PATH]
    hmrc = {}
    for path, doc in by_path.items():
        if path.startswith("guidance/rates-and-thresholds-for-employers-"):
            year, it, ni = _hmrc(doc)
            hmrc[year] = (it, ni, _vintage(doc))

    (cur, cur_vals), (prev, prev_vals) = _income_tax_current(it_doc), _income_tax_previous(it_doc)
    if int(prev[:4]) != int(cur[:4]) - 1:
        raise ValueError(f"{SOURCE_ID}: {INCOME_TAX_PATH}: previous year {prev} does not precede current year {cur}")
    income_tax = {cur: cur_vals, prev: prev_vals}
    ni_year, ni_page = _ni_page(ni_doc)

    out: list[Observation] = []
    today = date.today()

    def emit(year: str, prefix: str, vals: dict, keys, vintage: str) -> None:
        kind = "outturn" if date(int(year[:4]), 4, 6) <= today else "forecast"
        for k in keys:
            out.append(Observation(
                series_id=f"tax.{prefix}.{k}", period=year, geography=GEOGRAPHY, value=vals[k],
                unit=UNITS[k], kind=kind, source_id=SOURCE_ID, vintage=vintage, quality="sourced",
            ))

    for year, vals in sorted(income_tax.items()):
        if year in hmrc:
            _check(year, vals, hmrc[year][0], hmrc[year][0].keys(), "income-tax-rates and HMRC PAYE bands")
        emit(year, "income_tax", vals, INCOME_TAX_KEYS, _vintage(it_doc))

    if ni_year not in hmrc:
        raise ValueError(f"{SOURCE_ID}: no HMRC employer rates for {ni_year}, the year on {NI_PATH}")
    for year, (_, ni, vintage) in sorted(hmrc.items()):
        if year == ni_year:
            _check(year, ni, ni_page, ["main_rate", "upper_rate", "_weekly"], f"{NI_PATH} and HMRC NI")
        emit(year, "ni", ni, NI_KEYS, vintage)
    return out
