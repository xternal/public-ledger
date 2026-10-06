"""
HMRC "Direct effects of illustrative tax changes" (the tax ready reckoner).

Page:   https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes
Found:  GOV.UK content API for that page -> the spreadsheet attachment (ods/xlsx)
        and the HTML bulletin (notes, plus the "indicative level of current duty"
        column that the spreadsheet leaves out).

Emits   reckoner.<slug>   unit gbp_bn, kind "forecast", one observation per fiscal
        year the table gives (the June 2025 edition gives 2026-27, 2027-28, 2028-29
        for a change made in April 2026; each year, not a single "full year").

Sign convention (one rule for every slug):
    value = change in receipts (£bn) when the named parameter RISES by the step
    in the slug. So rates are positive (a rise raises money) and allowances and
    thresholds are negative (a rise costs money). For any change,
        receipts change ~= value x (change in parameter / step).
    HMRC prints most rows as unsigned "Change X by ..." magnitudes, and some as
    "(cost)" or "(yield)"; each row's direction is set in ROWS below.
    Where HMRC publishes a separate figure for a cut (the effects are not
    symmetric), the cut is a second slug ending in "_cut", expressed the same
    way: the slope to use for a fall in the parameter (a 1p cut changes
    receipts by -value).

Behaviour: HMRC's figures are not purely static. The bulletin and quality
report say most estimates include taxpayers' behavioural responses (taxable
income elasticities, incorporations, CGT elasticities), except Inheritance Tax,
Vehicle Excise Duty and Child Benefit. They exclude economy-wide (macro) effects,
and for the employer NICs rate they exclude the large incidence effects on
earnings and profits, which the OBR scores.

HMRC publishes central figures only, rounded (multiples of £5m; "Neg" means
above zero but rounds to zero, emitted here as 0.0 with a note).
"""

from __future__ import annotations

import json
import re
import warnings
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from etl.core import Observation, RawArtifact, Source, download, normalise_fiscal_year

SOURCE = Source(
    id="hmrc_reckoner",
    title="HMRC: Direct effects of illustrative tax changes",
    publisher="HMRC",
    url="https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes",
    cadence_days=365,
    grace_days=60,
)

CONTENT_API = "https://www.gov.uk/api/content/government/statistics/direct-effects-of-illustrative-tax-changes"
GOVUK = "https://www.gov.uk"

SHEET_TYPES = ("spreadsheet", "excel", "officedocument.spreadsheetml")
SHEET_SUFFIXES = (".ods", ".xlsx", ".xls")

# Sections where HMRC's quality report says no behavioural adjustment is made.
NO_BEHAVIOUR = re.compile(r"inheritance|vehicle excise|child benefit", re.I)

# (section regex, row-label regex, slug, sign). sign +1: HMRC's figure is already
# the receipts change for a rise (or the slope for a cut); -1: HMRC's figure is a
# cost of a rise, or a yield from a cut, so it is negated.
ROWS: list[tuple[str, str, str, int]] = [
    # Income Tax rates (exchequer impact for the UK government; Scottish/Welsh devolved elements excluded)
    (r"income tax rates", r"starting rate for savings", "income_tax_starting_rate_savings_1p", +1),
    (r"income tax rates", r"^change basic rate by 1p", "income_tax_basic_rate_1p", +1),
    (r"income tax rates", r"^change higher rate by 1p", "income_tax_higher_rate_1p", +1),
    (r"income tax rates", r"^increase additional rate by 1p", "income_tax_additional_rate_1p", +1),
    (r"income tax rates", r"^decrease additional rate by 1p", "income_tax_additional_rate_1p_cut", +1),
    # Income Tax allowances and reliefs (a rise costs money)
    (r"allowances and reliefs", r"personal allowance by £100\b", "personal_allowance_gbp100", -1),
    (r"allowances and reliefs", r"personal allowance by 1%", "personal_allowance_1pct", -1),
    (r"allowances and reliefs", r"personal allowance by 10%", "personal_allowance_10pct", -1),
    (r"allowances and reliefs", r"savings allowance", "income_tax_savings_allowance_gbp100", -1),
    (r"allowances and reliefs", r"dividend allowance", "income_tax_dividend_allowance_gbp100", -1),
    # Income Tax limits (a rise costs money)
    (r"^income tax limits", r"starting rate limit", "income_tax_starting_rate_limit_savings_gbp100", -1),
    (r"^income tax limits", r"^change basic rate limit by 1%", "income_tax_basic_rate_limit_1pct", -1),
    (r"^income tax limits", r"^increase basic rate limit by 10%", "income_tax_basic_rate_limit_10pct", -1),
    (r"^income tax limits", r"^decrease basic rate limit by 10%", "income_tax_basic_rate_limit_10pct_cut", -1),
    (r"starting and basic rate limits", r"^change all main allowances.*1%", "income_tax_all_allowances_limits_1pct", -1),
    (r"starting and basic rate limits", r"^increase all main allowances.*10%", "income_tax_all_allowances_limits_10pct", -1),
    (r"starting and basic rate limits", r"^decrease all main allowances.*10%", "income_tax_all_allowances_limits_10pct_cut", -1),
    # NICs rates
    (r"national insurance.*rates", r"class 1 employee main rate", "nics_employee_main_rate_1pp", +1),
    (r"national insurance.*rates", r"class 1 employee additional rate", "nics_employee_additional_rate_1pp", +1),
    (r"national insurance.*rates", r"class 1 employer rate", "nics_employer_rate_1pp", +1),
    (r"national insurance.*rates", r"class 4 main rate", "nics_class4_main_rate_1pp", +1),
    (r"national insurance.*rates", r"class 4 additional rate", "nics_class4_additional_rate_1pp", +1),
    # NICs limits. Raising a threshold costs money; raising the upper earnings or
    # upper profits limit yields (income moves from the 2% to the main rate).
    (r"national insurance.*limits", r"employee entry threshold|primary threshold", "nics_primary_threshold_gbp2pw", -1),
    (r"national insurance.*limits", r"employer threshold|secondary threshold", "nics_secondary_threshold_gbp2pw", -1),
    (r"national insurance.*limits", r"lower profits limit", "nics_lower_profits_limit_gbp104pa", -1),
    (r"national insurance.*limits", r"upper profits limit", "nics_upper_profits_limit_gbp520pa", +1),
    (r"national insurance.*limits", r"upper earnings limit", "nics_upper_earnings_limit_gbp10pw", +1),
    # Child Benefit (spending, shown as the exchequer effect)
    (r"child benefit", r"^increase first child", "child_benefit_first_child_gbp1pw", -1),
    (r"child benefit", r"^decrease first child", "child_benefit_first_child_gbp1pw_cut", -1),
    (r"child benefit", r"^increase subsequent child", "child_benefit_other_child_gbp1pw", -1),
    (r"child benefit", r"^decrease subsequent child", "child_benefit_other_child_gbp1pw_cut", -1),
    # Corporation tax (main rate and small profits rate together, onshore only)
    (r"corporation tax", r"corporation tax by 1 percentage point", "corp_tax_main_rate_1pp", +1),
    # Capital Gains Tax (HMRC signs these: negative = net loss; non-linear, do not scale)
    (r"capital gains", r"business asset disposal.*by 1 percentage", "cgt_badr_rate_1pp", +1),
    (r"capital gains", r"business asset disposal.*by 5 percentage", "cgt_badr_rate_5pp", +1),
    (r"capital gains", r"lower capital gains.*by 1 percentage", "cgt_lower_rate_1pp", +1),
    (r"capital gains", r"lower capital gains.*by 5 percentage", "cgt_lower_rate_5pp", +1),
    (r"capital gains", r"lower capital gains.*by 10 percentage", "cgt_lower_rate_10pp", +1),
    (r"capital gains", r"higher capital gains.*by 1 percentage", "cgt_higher_rate_1pp", +1),
    (r"capital gains", r"higher capital gains.*by 5 percentage", "cgt_higher_rate_5pp", +1),
    (r"capital gains", r"higher capital gains.*by 10 percentage", "cgt_higher_rate_10pp", +1),
    (r"capital gains", r"annual exempt amount", "cgt_annual_exempt_amount_gbp500", +1),
    # Inheritance tax
    (r"inheritance", r"standard rate.*1 percentage", "iht_rate_1pp", +1),
    (r"inheritance", r"^increase nil rate band", "iht_nil_rate_band_gbp5000", -1),
    (r"inheritance", r"residence nil rate band", "iht_residence_nil_rate_band_gbp5000", -1),
    # 1% change in duties (a 1% rise in the duty rate)
    (r"1% change", r"beer", "alcohol_duty_beer_cider_1pct", +1),
    (r"1% change", r"wine", "alcohol_duty_wine_1pct", +1),
    (r"1% change", r"spirits", "alcohol_duty_spirits_1pct", +1),
    (r"1% change", r"tobacco", "tobacco_duty_1pct", +1),
    (r"1% change", r"^petrol", "fuel_duty_petrol_1pct", +1),
    (r"1% change", r"^diesel", "fuel_duty_diesel_1pct", +1),
    (r"1% change", r"rebated oil", "fuel_duty_rebated_oil_1pct", +1),
    (r"1% change", r"climate change levy", "climate_change_levy_1pct", +1),
    (r"1% change", r"carbon price", "carbon_price_support_1pct", +1),
    (r"1% change", r"aggregates", "aggregates_levy_1pct", +1),
    (r"1% change", r"landfill", "landfill_tax_1pct", +1),
    # VED, APD (£1 for motorbikes and £5 for other vehicles; £1 on the reduced APD rate)
    (r"vehicle excise", r"increase rates", "ved_rates_gbp5", +1),
    (r"air passenger", r"reduced rate", "apd_reduced_rate_gbp1", +1),
    # VAT, IPT
    (r"^vat", r"reduced rate", "vat_reduced_rate_1pp", +1),
    (r"^vat", r"standard rate", "vat_standard_rate_1pp", +1),
    (r"insurance premium", r"standard rate", "ipt_standard_rate_1pp", +1),
    (r"insurance premium", r"higher rate", "ipt_higher_rate_1pp", +1),
    # SDLT ("Raise ... (Yield)" = rise; "Cut ... (Cost)" = _cut. HMRC: negative
    # costs are net yields and negative yields are net costs, so signs carry through.)
    (r"stamp duty", r"^raise residential 2%", "sdlt_residential_2pct_band_1pp", +1),
    (r"stamp duty", r"^cut residential 2%", "sdlt_residential_2pct_band_1pp_cut", +1),
    (r"stamp duty", r"^raise residential 5%", "sdlt_residential_5pct_band_1pp", +1),
    (r"stamp duty", r"^cut residential 5%", "sdlt_residential_5pct_band_1pp_cut", +1),
    (r"stamp duty", r"^raise residential 10%", "sdlt_residential_10pct_band_1pp", +1),
    (r"stamp duty", r"^cut residential 10%", "sdlt_residential_10pct_band_1pp_cut", +1),
    (r"stamp duty", r"^raise residential 12%", "sdlt_residential_12pct_band_1pp", +1),
    (r"stamp duty", r"^cut residential 12%", "sdlt_residential_12pct_band_1pp_cut", +1),
    (r"stamp duty", r"^increase higher rates.*additional dwellings", "sdlt_additional_dwellings_1pp", +1),
    (r"stamp duty", r"^decrease higher rates.*additional dwellings", "sdlt_additional_dwellings_1pp_cut", +1),
    (r"stamp duty", r"^increase nrsdlt", "sdlt_non_resident_surcharge_1pp", +1),
    (r"stamp duty", r"^decrease nrsdlt", "sdlt_non_resident_surcharge_1pp_cut", +1),
    (r"stamp duty", r"^increase non-residential 5%", "sdlt_non_residential_5pct_band_1pp", +1),
    (r"stamp duty", r"^decrease non-residential 5%", "sdlt_non_residential_5pct_band_1pp_cut", +1),
]

# The build and the levers rely on these. parse() fails loudly if one is missing.
REQUIRED = (
    "income_tax_basic_rate_1p",
    "income_tax_higher_rate_1p",
    "income_tax_additional_rate_1p",
    "personal_allowance_gbp100",
    "nics_employee_main_rate_1pp",
    "nics_employer_rate_1pp",
    "vat_standard_rate_1pp",
    "corp_tax_main_rate_1pp",
    "fuel_duty_petrol_1pct",
    "fuel_duty_diesel_1pct",
)

# Rows of the latest parse that matched nothing in ROWS (a new edition added or
# renamed a row). The test asserts this is empty for the current file.
UNMAPPED: list[tuple[str, str]] = []


# --------------------------------------------------------------------------- fetch


def _edition(content: dict) -> date | None:
    """Date of the latest edition: the newest change-history entry (major updates only)."""
    stamps = [c.get("public_timestamp") for c in content.get("details", {}).get("change_history", [])]
    stamps = [s for s in stamps if s]
    if not stamps:
        stamps = [content.get("first_public_at") or content.get("public_updated_at")]
    stamps = [s for s in stamps if s]
    return max(datetime.fromisoformat(s.replace("Z", "+00:00")).date() for s in stamps) if stamps else None


def vintage_for(day: date | None) -> str:
    return f"HMRC-DE-{day:%Y-%m}" if day else "HMRC-DE-unknown"


def _is_sheet(att: dict) -> bool:
    ctype = (att.get("content_type") or "").lower()
    url = (att.get("url") or "").lower()
    return any(t in ctype for t in SHEET_TYPES) or url.endswith(SHEET_SUFFIXES)


def fetch(since: date | None = None) -> list[RawArtifact]:
    """
    Read the GOV.UK content API for the page, then download the latest
    spreadsheet and the HTML bulletin. Returns [] if `since` is given and the
    edition is not newer than it.
    """
    meta = download(SOURCE.id, CONTENT_API, "content.json")
    content = json.loads(meta.path.read_text())
    published = _edition(content)
    SOURCE.published_on = published
    vintage = vintage_for(published)
    meta.vintage = vintage
    if since and published and published <= since:
        return []

    attachments = content.get("details", {}).get("attachments", [])
    sheets = [a for a in attachments if _is_sheet(a)]
    if not sheets:
        raise RuntimeError(f"{SOURCE.id}: no spreadsheet attachment on {SOURCE.url}")
    raws = [meta, download(SOURCE.id, sheets[0]["url"], vintage=vintage)]

    html = [a for a in attachments if a.get("attachment_type") == "html" and (a.get("url") or "").startswith("/")]
    if html:
        raws.append(download(SOURCE.id, f"{GOVUK}/api/content{html[0]['url']}", "bulletin.json", vintage=vintage))
    return raws


# --------------------------------------------------------------------------- parse


def _clean(text) -> str:
    return " ".join(str(text).replace("\xa0", " ").split())


def _number(cell) -> tuple[float | None, bool]:
    """(value in the sheet's unit, negligible?)"""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return None, False
    if isinstance(cell, (int, float)):
        return float(cell), False
    s = _clean(cell).replace(",", "").replace("£", "")
    if s.lower() in ("neg", "negligible"):
        return 0.0, True
    if s in ("", "-", "–", "..", "[x]", "n/a"):
        return None, False
    try:
        return float(s), False
    except ValueError:
        return None, False


def _year_columns(row: list) -> dict[int, tuple[str, float]]:
    """Header cells like "Current Estimate, financial year 2026 to 2027, £ million" -> {col: ("2026-27", scale to £bn)}."""
    out: dict[int, tuple[str, float]] = {}
    for i, cell in enumerate(row):
        text = _clean(cell)
        m = re.search(r"(\d{4})\s*(?:to|-|/|–)\s*(\d{2,4})", text)
        if not m:
            continue
        period = normalise_fiscal_year(f"{m.group(1)}-{m.group(2)}")
        if not period:
            continue
        low = text.lower()
        scale = 1.0 if ("billion" in low or "£bn" in low) else 0.001  # HMRC tabulates £ million
        out[i] = (period, scale)
    return out


def _match(section: str, label: str) -> tuple[str, int] | None:
    for sec_re, lab_re, slug, sign in ROWS:
        if re.search(sec_re, section, re.I) and re.search(lab_re, label, re.I):
            return slug, sign
    return None


def parse_table(df: pd.DataFrame) -> list[dict]:
    """
    Read the ready-reckoner sheet into rows:
    {slug, period, value_bn (our sign convention), negligible, section, label, sign}.
    """
    UNMAPPED.clear()
    rows = df.values.tolist()
    header_at, cols = None, {}
    for i, r in enumerate(rows):
        cols = _year_columns(r)
        if len(cols) >= 2:
            header_at = i
            break
    if header_at is None:
        raise ValueError("hmrc_reckoner: no header row with fiscal-year columns")

    out: list[dict] = []
    section = ""
    seen: set[str] = set()
    for r in rows[header_at + 1 :]:
        label = _clean(r[0]) if r and not (isinstance(r[0], float) and pd.isna(r[0])) else ""
        if not label:
            continue
        cells = {c: _number(r[c]) for c in cols if c < len(r)}
        if all(v is None for v, _ in cells.values()):
            if not re.match(r"(for detailed|end of|neg stands|source|note)", label, re.I):
                section = label
            continue
        hit = _match(section, label)
        if not hit:
            UNMAPPED.append((section, label))
            continue
        slug, sign = hit
        if slug in seen:
            raise ValueError(f"hmrc_reckoner: two rows map to {slug} ({section} / {label})")
        seen.add(slug)
        for c, (value, neg) in cells.items():
            if value is None:
                continue
            period, scale = cols[c]
            out.append(
                {
                    "slug": slug,
                    "period": period,
                    "value_bn": round(sign * value * scale + 0.0, 6),
                    "negligible": neg,
                    "section": section,
                    "label": label,
                    "sign": sign,
                }
            )
    if UNMAPPED:
        warnings.warn(f"hmrc_reckoner: rows not mapped to a slug: {UNMAPPED}")
    return out


def _read_sheet(path: Path) -> pd.DataFrame:
    engine = "odf" if path.suffix.lower() == ".ods" else None
    sheets = pd.read_excel(path, sheet_name=None, header=None, engine=engine)
    for df in sheets.values():
        text = " ".join(_clean(x) for x in df.iloc[:, 0].dropna().tolist()[:80]).lower()
        if "basic rate" in text and ("vat" in text or "corporation tax" in text):
            return df
    raise ValueError(f"hmrc_reckoner: no ready-reckoner sheet in {path.name}")


def fuel_duty_rate_pence(bulletin_html: str) -> float | None:
    """
    Main fuel duty rate (pence per litre) in the first year of the table, from the
    bulletin: the 'indicative level of current duty' on the Petrol row, plus any
    pence the notes say the baseline adds back (June 2025: '+5 pence', the end of
    the 5p cut assumed in April 2026).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(bulletin_html, "html.parser")
    rate = None
    for tr in soup.find_all("tr"):
        cells = [_clean(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
        if cells and re.match(r"petrol", cells[0], re.I):
            for c in cells[1:]:
                m = re.search(r"(\d+(?:\.\d+)?)\s*p(?:ence)?\s+per\s+litre", c, re.I)
                if m:
                    rate = float(m.group(1))
                    break
    if rate is None:
        return None
    text = _clean(soup.get_text(" "))
    m = re.search(r"adding (\d+(?:\.\d+)?) pence to the \d{4} to \d{4} ready reckoned duty rate", text, re.I)
    return rate + (float(m.group(1)) if m else 0.0)


def _note(row: dict, vintage: str) -> str:
    behaviour = (
        "No behavioural adjustment (HMRC quality report)."
        if NO_BEHAVIOUR.search(row["section"])
        else "Includes taxpayers' behavioural response where HMRC models one; no economy-wide effects."
    )
    sign = (
        "Sign: + = more receipts when the parameter rises."
        if not row["slug"].endswith("_cut")
        else "Slope for a cut: a cut of one step changes receipts by minus this value."
    )
    if row["sign"] < 0:
        sign += " HMRC prints this as a magnitude (cost of a rise or yield from a cut); negated here."
    note = f"HMRC row '{row['label']}' [{row['section']}], {vintage}, £m/1000. {sign} {behaviour}"
    if row["negligible"]:
        note += " HMRC shows 'Neg': above zero but rounds to zero; 0.0 here."
    if row["slug"] == "nics_employer_rate_1pp":
        note += " Excludes the incidence effects on wages and profits that the OBR scores separately."
    return note


def parse(raws: list[RawArtifact]) -> list[Observation]:
    sheet = next((r for r in raws if r.path.suffix.lower() in SHEET_SUFFIXES), None)
    if sheet is None:
        raise ValueError("hmrc_reckoner: no spreadsheet among the raw files")
    vintage = sheet.vintage
    content = next((r for r in raws if r.path.name == "content.json"), None)
    if not vintage and content:
        vintage = vintage_for(_edition(json.loads(content.path.read_text())))
    vintage = vintage or "HMRC-DE-unknown"

    rows = parse_table(_read_sheet(sheet.path))
    got = {r["slug"] for r in rows}
    missing = [s for s in REQUIRED if s not in got]
    if missing:
        raise ValueError(f"hmrc_reckoner: required rows not found: {missing}")

    obs = [
        Observation(
            series_id=f"reckoner.{r['slug']}",
            period=r["period"],
            value=r["value_bn"],
            unit="gbp_bn",
            kind="forecast",
            source_id=SOURCE.id,
            vintage=vintage,
            quality="sourced",
            method_note=_note(r, vintage),
        )
        for r in rows
    ]

    # Derived: 1p per litre on the main fuel duty rates (petrol + diesel), from HMRC's 1% rows.
    bulletin = next((r for r in raws if r.path.name == "bulletin.json"), None)
    rate = None
    if bulletin:
        rate = fuel_duty_rate_pence(json.loads(bulletin.path.read_text()).get("details", {}).get("body", ""))
    if rate:
        per_period: dict[str, float] = {}
        for r in rows:
            if r["slug"] in ("fuel_duty_petrol_1pct", "fuel_duty_diesel_1pct"):
                per_period[r["period"]] = per_period.get(r["period"], 0.0) + r["value_bn"]
        for period, one_pct in sorted(per_period.items()):
            obs.append(
                Observation(
                    series_id="reckoner.fuel_duty_1p",
                    period=period,
                    value=round(one_pct / (rate / 100.0), 4),
                    unit="gbp_bn",
                    kind="forecast",
                    source_id=SOURCE.id,
                    vintage=vintage,
                    quality="approx",
                    method_note=(
                        f"Derived, not published: HMRC's 1% petrol + diesel rows ({one_pct * 1000:.0f}m) divided by 1% of "
                        f"a {rate:.2f}p/litre main rate, so 1p/litre = 1% x 100/{rate:.2f}. {rate:.2f}p is the bulletin's "
                        "current rate plus the pence its notes say the baseline adds back. HMRC also uprates the baseline "
                        "rate by forecast RPI each April, so this overstates 1p by roughly cumulative RPI (a few % in year "
                        "one, more later). Includes behavioural response; no economy-wide effects."
                    ),
                )
            )
    else:
        warnings.warn("hmrc_reckoner: fuel duty rate not found in the bulletin; reckoner.fuel_duty_1p not emitted")
    return obs
