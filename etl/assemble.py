"""
Assemble what the app reads from normalised observations: a Statement per
fiscal year, the macro block, sandbox levers and tax rates. Pure functions over
the Store; every choice of source is written down here.
"""

from __future__ import annotations

from etl.build import Run, Store, fy_start, note_of
from etl.core import Observation, Source
from etl.statement_lines import ACCOUNTING, DEBT_INTEREST, PLUG_THRESHOLD_SHARE, RECEIPT_LINES, SPENDING_LINES

FIRST_STATEMENT_YEAR = "2019-20"
BALANCE_TOLERANCE_BN = 0.1

# Source priority. OBR first so receipts lines and totals come from one table.
OBR = ["obr_efo", "obr_databank", "obr_receipts_history", "ons_psf"]
PESA = ["hmt_pesa"]


def statement_years(store: Store) -> list[str]:
    years = set()
    for sid in OBR[:3]:
        years.update(store.periods("receipts.total", sid))
    return sorted(y for y in years if y >= FIRST_STATEMENT_YEAR)


def pesa_lines(store: Store, year: str) -> tuple[dict[str, float], str, str] | None:
    """Function lines for a year from PESA, or None if PESA does not cover it."""
    vals: dict[str, float] = {}
    vintage = kind = ""
    for line_id, _label, _desc, parts in SPENDING_LINES:
        total = 0.0
        for p in parts:
            neg = p.startswith("-")
            o = store.get(p.lstrip("-"), year, PESA)
            if o is None:
                if p.endswith("eu_transactions"):
                    continue
                return None
            total += -o.value if neg else o.value
            vintage, kind = o.vintage, o.kind
        vals[line_id] = total
    return vals, vintage, kind


def assemble_statement(store: Store, year: str, run: Run, sources_by_id: dict[str, Source]) -> dict | None:
    total = store.get("receipts.total", year, OBR)
    tme = store.get("spending.tme", year, [total.source_id] if total else OBR)
    di = store.get("spending.debt_interest", year, [total.source_id] if total else OBR)
    if not (total and tme and di):
        run.add("coverage", "error", year, "missing receipts.total, spending.tme or spending.debt_interest from OBR")
        return None
    receipts = []
    for line_id, label, series in RECEIPT_LINES:
        o = store.get(series, year, [total.source_id])
        if o is None:
            run.add("coverage", "error", f"{year} {series}", f"missing from {total.source_id}")
            return None
        receipts.append({"id": line_id, "label": label, "bn": round(o.value, 3), **note_of(o)})
    rec_sum = sum(r["bn"] for r in receipts)
    gap = rec_sum - total.value
    if abs(gap) > BALANCE_TOLERANCE_BN:
        run.add("mapping", "error", year, f"receipt lines sum to {rec_sum:.1f} but receipts.total is {total.value:.1f}", gap)

    # Spending: PESA functions where PESA covers the year; otherwise the latest PESA shares scaled.
    pesa = pesa_lines(store, year)
    spending: list[dict] = []
    if pesa:
        vals, pesa_vintage, pesa_kind = pesa
        for line_id, label, desc, _ in SPENDING_LINES:
            spending.append({"id": line_id, "label": label, "desc": desc, "bn": round(vals[line_id], 3), "quality": "sourced", "source_id": "hmt_pesa",
                             "method_note": f"HMT PESA ({pesa_vintage}), COFOG function{'s' if line_id in ('housing_env', 'general_services') else ''}{' excluding debt interest' if line_id == 'general_services' else ''}."})
        functions_from = "pesa"
    else:
        pesa_years = sorted({p for (s, p, sid) in store.idx if sid == "hmt_pesa" and s == "spending.tes.total"})
        ref = pesa_years[-1] if pesa_years else None
        ref_lines = pesa_lines(store, ref) if ref else None
        if not ref_lines:
            run.add("coverage", "error", year, "no PESA year available to split spending by function")
            return None
        ref_vals = ref_lines[0]
        ref_total = sum(ref_vals.values())
        # Scale the reference split to this year's TME less debt interest, keeping the reference
        # year's share of accounting adjustments.
        ref_tme = store.get("spending.tme", ref, OBR)
        ref_di = store.get("spending.debt_interest", ref, OBR)
        services_share = ref_total / (ref_tme.value - ref_di.value) if ref_tme and ref_di else 1.0
        target = (tme.value - di.value) * services_share
        for line_id, label, desc, _ in SPENDING_LINES:
            spending.append({"id": line_id, "label": label, "desc": desc, "bn": round(ref_vals[line_id] / ref_total * target, 3), "quality": "approx", "source_id": "hmt_pesa",
                             "method_note": f"No function split is published for {year}. {ref} PESA shares applied to OBR's total spending less debt interest."})
        functions_from = f"scaled from {ref}"

    spending.append({"id": DEBT_INTEREST[0], "label": DEBT_INTEREST[1], "desc": DEBT_INTEREST[2], "bn": round(di.value, 3), **note_of(di)})
    functions_sum = sum(s["bn"] for s in spending)
    residual = tme.value - functions_sum
    published_aa = store.get("spending.accounting_adjustments", year, PESA)
    unexplained = residual - (published_aa.value if published_aa else 0.0)
    plug = abs(unexplained) > PLUG_THRESHOLD_SHARE * tme.value or (functions_from != "pesa" and False)
    note = (
        f"OBR total spending ({tme.value:,.1f}bn) minus the function lines and OBR debt interest."
        + (f" PESA publishes accounting adjustments of {published_aa.value:,.1f}bn for {year}; the remaining {unexplained:,.1f}bn comes from"
           " differences between OBR and PESA totals and debt-interest definitions." if published_aa else "")
    )
    spending.append({"id": ACCOUNTING[0], "label": ACCOUNTING[1], "desc": ACCOUNTING[2], "bn": round(residual, 3),
                     "quality": "approx", "source_id": tme.source_id, "method_note": note, **({"plug": True} if plug else {})})

    borrowing = round(sum(s["bn"] for s in spending) - sum(r["bn"] for r in receipts), 3)
    psnb = store.get("fiscal.psnb", year, [total.source_id] + OBR)
    if psnb is not None:
        identity_gap = borrowing - psnb.value
        level = "warning" if abs(identity_gap) > 1.0 else "info"
        run.add("identity", level, year, f"receipts + borrowing = TME gives borrowing {borrowing:.1f}bn; published PSNB is {psnb.value:.1f}bn", identity_gap)

    kind = "outturn" if total.kind == "outturn" else "forecast"
    used = sorted({total.source_id, tme.source_id, di.source_id, "hmt_pesa"} | {r["source_id"] for r in receipts})
    return {
        "receipts": receipts,
        "spending": spending,
        "borrowing_bn": borrowing,
        "borrowing_provenance": {
            "quality": "sourced",
            "source_id": tme.source_id,
            "method_note": "Total spending minus receipts, from the same OBR table"
            + (f"; OBR's published borrowing for {year} is {psnb.value:,.1f}bn" if psnb else "")
            + ".",
        },
        "_kind": kind,
        "_vintages": sorted({total.vintage, tme.vintage, di.vintage} | ({pesa[1]} if pesa else set())),
        "_used": used,
        "_functions_from": functions_from,
    }


def macro_for(store: Store, year: str, base_paths: dict, run: Run, family: str = "obr_efo") -> dict:
    # Outturn years take debt from ONS public sector finances; GDP always comes from the OBR (fiscal-year basis).
    debt_sources = ["ons_psf"] + OBR if family == "ons_psf_receipts" else OBR
    gdp = store.get("macro.nominal_gdp", year, ["obr_databank", "obr_efo"] if family != "obr_efo" else OBR)
    psnd = store.get("fiscal.psnd", year, debt_sources)
    psnd_pct = store.get("fiscal.psnd_pct_gdp", year, debt_sources)
    rate = latest_bank_rate(store, year)
    households = for_year(store, "people.households", "ons_households", str(fy_start(year)))
    taxpayers = for_year(store, "people.income_taxpayers", "hmrc_taxpayers", year)
    population = for_year(store, "people.population", "ons_population", str(fy_start(year)))
    missing = [n for n, o in [("gdp", gdp), ("psnd", psnd), ("psnd_pct", psnd_pct), ("bank_rate", rate), ("households", households), ("taxpayers", taxpayers), ("population", population)] if o is None]
    if missing:
        run.add("coverage", "error", year, f"macro inputs missing: {', '.join(missing)}")
        return {}
    return {
        "nominal_gdp_bn": round(gdp.value, 3),
        "psnd_bn": round(psnd.value, 3),
        "psnd_pct_gdp": round(psnd_pct.value, 3),
        "bank_rate_pct": rate.value,
        "bank_rate_date": rate.period,
        "households_m": round(households.value, 3),
        "income_taxpayers_m": round(taxpayers.value, 3),
        "population_m": round(population.value, 3),
        "baseline_psnb_bn": base_paths["psnb"],
        "baseline_nominal_growth_pct": base_paths["growth"],
        "baseline_psnd_pct_gdp": base_paths["psnd_pct"],
        "provenance": {
            "nominal_gdp_bn": note_of(gdp),
            "psnd_bn": note_of(psnd),
            "psnd_pct_gdp": note_of(psnd_pct),
            "bank_rate_pct": note_of(rate),
            "households_m": {**note_of(households), "method_note": f"ONS Families and households, UK, {households.period} ({households.vintage})."},
            "income_taxpayers_m": {**note_of(taxpayers), "method_note": f"HMRC individual income taxpayers, {taxpayers.period}{' (projected)' if taxpayers.kind != 'outturn' else ''} ({taxpayers.vintage})."},
            "population_m": {**note_of(population), "method_note": f"ONS mid-year population estimate, UK, {population.period} ({population.vintage})."},
            "baseline_psnb_bn": base_paths["psnb_note"],
            "baseline_psnd_pct_gdp": base_paths["psnd_note"],
            "baseline_nominal_growth_pct": base_paths["growth_note"],
        },
    }


def for_year(store: Store, series: str, source: str, period: str) -> Observation | None:
    """The observation for a period, or the nearest earlier one (or the earliest) when it is not published."""
    periods = store.periods(series, source)
    if not periods:
        return None
    eligible = [p for p in periods if p <= period] or periods[:1]
    return store.idx[(series, eligible[-1], source)]


def latest_bank_rate(store: Store, year: str) -> Observation | None:
    """Bank Rate in force at the end of a fiscal year, or today for the current and future years."""
    dates = store.periods("macro.bank_rate", "boe_bank_rate")
    if not dates:
        return None
    end = f"{fy_start(year) + 1}-03-31"
    eligible = [d for d in dates if d <= end] or dates[:1]
    return store.idx[("macro.bank_rate", eligible[-1], "boe_bank_rate")]


def baseline_paths(store: Store, base_year: str) -> dict:
    years = [y for y in store.periods("fiscal.psnb", "obr_efo") if y >= base_year]
    psnb = {y: round(store.get("fiscal.psnb", y, ["obr_efo"]).value, 3) for y in years}
    psnd = {y: round(store.get("fiscal.psnd_pct_gdp", y, ["obr_efo"]).value, 3) for y in years}
    gdps = [store.get("macro.nominal_gdp", y, ["obr_efo"]).value for y in years]
    growth = ((gdps[-1] / gdps[0]) ** (1 / (len(gdps) - 1)) - 1) * 100 if len(gdps) > 1 else 0.0
    vintage = store.get("fiscal.psnb", years[0], ["obr_efo"]).vintage
    return {
        "psnb": psnb,
        "psnd_pct": psnd,
        "growth": round(growth, 3),
        "psnb_note": {"quality": "sourced", "source_id": "obr_efo"},
        "psnd_note": {"quality": "sourced", "source_id": "obr_efo"},
        "growth_note": {"quality": "approx", "source_id": "obr_efo", "method_note": f"Average annual growth of OBR nominal GDP, {years[0]} to {years[-1]} ({vintage})."},
    }




# ------------------------------------------------------------------ orchestration

import json
from datetime import date

from etl.core import ROOT

SEED = ROOT / "data" / "seed"
# Sources that can supply a full receipts breakdown for a year, in priority order.
# For a completed year the build prefers any of them that marks the year as outturn.
RECEIPT_FAMILIES = ["ons_psf_receipts", "obr_databank", "obr_receipts_history", "obr_efo"]
# Where totals (TME, debt interest, borrowing) come from for each receipts family.
TOTALS_FOR = {
    "ons_psf_receipts": ["ons_psf", "obr_databank", "obr_efo"],
    "obr_databank": ["obr_databank", "obr_efo"],
    "obr_receipts_history": ["obr_databank", "obr_efo"],
    "obr_efo": ["obr_efo"],
}
# Where outturn (ONS) and forecast (OBR) years use a different basis for the same line.
BASIS_NOTES = {
    ("ons_psf_receipts", "business_rates"): "ONS outturn basis. The OBR forecast for later years uses a wider definition (about £3bn more in 2024-25), so the line steps up where outturn meets forecast.",
    ("ons_psf_receipts", "non_tax"): "ONS outturn basis; it includes some receipts the OBR forecast shows under business rates.",
}
EDITORIAL_RANGE_HMRC = 0.10  # HMRC publishes central costings only
EDITORIAL_RANGE_OBR_RATES = 0.20  # OBR debt-interest sensitivities, central only


def year_ended(year: str, today: date) -> bool:
    return date(fy_start(year) + 1, 3, 31) < today


def receipts_family(store: Store, year: str) -> str | None:
    """The first source with a total and all 13 lines for the year; outturn beats estimate."""
    complete = []
    for sid in RECEIPT_FAMILIES:
        total = store.get("receipts.total", year, [sid])
        if total and all(store.get(series, year, [sid]) for _, _, series in RECEIPT_LINES):
            complete.append((0 if total.kind == "outturn" else 1, RECEIPT_FAMILIES.index(sid), sid))
    return sorted(complete)[0][2] if complete else None


def assemble_year(store: Store, year: str, run: Run, today: date) -> dict | None:
    family = receipts_family(store, year)
    if family is None:
        run.add("coverage", "error", year, "no source has receipts.total and all 13 receipt lines")
        return None
    totals = TOTALS_FOR.get(family, [family])
    total = store.get("receipts.total", year, [family])
    tme = store.get("spending.tme", year, totals)
    di = store.get("spending.debt_interest", year, totals)
    if not (tme and di):
        run.add("coverage", "error", year, f"missing TME or debt interest for the {family} family")
        return None
    receipts = []
    for line_id, label, series in RECEIPT_LINES:
        o = store.get(series, year, [family])
        line = {"id": line_id, "label": label, "bn": round(o.value, 3), **note_of(o)}
        basis = BASIS_NOTES.get((family, line_id))
        if basis:
            line["method_note"] = f"{line.get('method_note', '').rstrip('.')}. {basis}".lstrip(". ")
        receipts.append(line)
    rec_sum = sum(r["bn"] for r in receipts)
    if abs(rec_sum - total.value) > BALANCE_TOLERANCE_BN:
        run.add("mapping", "error", year, f"receipt lines sum to {rec_sum:.1f} but {family} receipts.total is {total.value:.1f}", rec_sum - total.value)

    pesa = pesa_lines(store, year)
    spending: list[dict] = []
    if pesa:
        vals, pesa_vintage, _ = pesa
        for line_id, label, desc, _parts in SPENDING_LINES:
            what = {"general_services": "COFOG general public services, excluding debt interest", "housing_env": "COFOG housing and community amenities plus environment protection"}.get(line_id)
            spending.append({"id": line_id, "label": label, "desc": desc, "bn": round(vals[line_id], 3), "quality": "sourced", "source_id": "hmt_pesa",
                             **({"method_note": f"{what} ({pesa_vintage})."} if what else {})})
        functions_from = pesa_vintage
        ref = year
    else:
        pesa_years = store.periods("spending.tes.total", "hmt_pesa")
        ref = next((y for y in reversed(pesa_years) if pesa_lines(store, y)), None)
        if ref is None:
            run.add("coverage", "error", year, "no PESA year to split spending by function")
            return None
        ref_vals = pesa_lines(store, ref)[0]
        ref_sum = sum(ref_vals.values())
        target = tme.value - di.value - spending_reconciliation_share(store, ref) * tme.value
        for line_id, label, desc, _parts in SPENDING_LINES:
            spending.append({"id": line_id, "label": label, "desc": desc, "bn": round(ref_vals[line_id] / ref_sum * target, 3), "quality": "approx", "source_id": "hmt_pesa",
                             "method_note": f"No function split is published for {year}. Each function keeps its {ref} share (HMT PESA) of {tme.source_id.upper().replace('_', ' ')} total spending less debt interest and accounting adjustments."})
        functions_from = f"scaled from {ref}"

    spending.append({"id": DEBT_INTEREST[0], "label": DEBT_INTEREST[1], "desc": DEBT_INTEREST[2], "bn": round(di.value, 3), **note_of(di)})
    residual = tme.value - sum(s["bn"] for s in spending)
    note, plug = accounting_note(store, year if pesa else ref, tme, di, residual, scaled=not pesa)
    spending.append({"id": ACCOUNTING[0], "label": ACCOUNTING[1], "desc": ACCOUNTING[2], "bn": round(residual, 3), "quality": "approx", "source_id": tme.source_id,
                     "method_note": note, **({"plug": True} if plug else {})})

    borrowing = round(sum(s["bn"] for s in spending) - rec_sum, 3)
    psnb = store.get("fiscal.psnb", year, totals)
    if psnb is not None:
        gap = borrowing - psnb.value
        run.add("identity", "warning" if abs(gap) > 1.0 else "info", year, f"spending minus receipts = {borrowing:.1f}bn; published borrowing {psnb.value:.1f}bn ({psnb.source_id})", gap)
    ons = store.get("fiscal.psnb", year, ["ons_psf"])
    if ons is not None and family != "ons_psf_receipts":
        run.add("identity", "info", year, f"ONS outturn borrowing {ons.value:.1f}bn vs statement {borrowing:.1f}bn", borrowing - ons.value)

    kind = "outturn" if total.kind == "outturn" else ("estimate" if year_ended(year, today) else "forecast")
    return {
        "receipts": receipts,
        "spending": spending,
        "borrowing_bn": borrowing,
        "borrowing_provenance": {
            "quality": "sourced",
            "source_id": tme.source_id,
            "method_note": f"Total spending minus receipts ({tme.vintage})" + (f". Published borrowing for {year}: {psnb.value:,.1f}bn" if psnb else "") + ".",
        },
        "kind": kind,
        "family": family,
        "vintages": sorted({total.vintage, tme.vintage, di.vintage} | ({pesa[1]} if pesa else set())),
        "functions_from": functions_from,
        "used": sorted({total.source_id, tme.source_id, di.source_id, "hmt_pesa"} | {r["source_id"] for r in receipts if r.get("source_id")}),
    }


def accounting_note(store: Store, ref: str, tme: Observation, di: Observation, residual: float, scaled: bool) -> tuple[str, bool]:
    """
    Explain the accounting line from published numbers. For a PESA year:
        residual = PESA accounting adjustments
                 + (PESA debt interest - OBR debt interest)   mostly notional pension interest
                 + (total spending used here - PESA total spending)
    which holds exactly, so the line is a reconciliation, not a plug. A plug is
    flagged only when PESA publishes no accounting adjustments to explain it.
    """
    aa = store.get("spending.accounting_adjustments", ref, PESA)
    if aa is None:
        return ("Total spending minus the function lines and debt interest. HMT PESA publishes no accounting adjustments for this year, so this is a balancing figure.", True)
    if scaled:
        return (f"Accounting adjustments kept at their {ref} share of total spending (HMT PESA {aa.vintage}: {aa.value:,.1f}bn in {ref}). Includes items such as public corporations' capital spending, locally financed spending and national-accounts adjustments.", False)
    pesa_di = store.get("spending.cofog.general_public_services.debt_interest", ref, PESA)
    pesa_tme = store.get("spending.tme", ref, PESA)
    pensions = store.get("spending.cofog.general_public_services.debt_interest.public_sector_pensions", ref, PESA)
    parts = [f"HMT PESA accounting adjustments {aa.value:,.1f}bn"]
    if pesa_di:
        extra = pesa_di.value - di.value
        parts.append(f"{extra:,.1f}bn that PESA counts as debt interest but the OBR measure used for the debt interest line does not" + (f" (mostly {pensions.value:,.1f}bn of notional interest on unfunded public-service pensions)" if pensions else ""))
    if pesa_tme:
        gap = tme.value - pesa_tme.value
        if abs(gap) >= 0.05:
            parts.append(f"{gap:,.1f}bn difference between total spending here ({tme.vintage}) and PESA's outturn")
    return ("Reconciles spending by function (HMT PESA) with total spending. Made up of: " + "; ".join(parts) + ".", False)


def spending_reconciliation_share(store: Store, year: str) -> float:
    """Accounting adjustments as a share of TME in a reference year (PESA), used when scaling forecasts."""
    aa = store.get("spending.accounting_adjustments", year, PESA)
    tme = store.get("spending.tme", year, ["hmt_pesa"] + OBR)
    return aa.value / tme.value if aa and tme else 0.0


def bank_rate_base(store: Store) -> Observation:
    dates = store.periods("macro.bank_rate", "boe_bank_rate")
    return store.idx[("macro.bank_rate", dates[-1], "boe_bank_rate")]


def ranged(central: float, share: float) -> list[float]:
    return [round(central * (1 - share), 4), round(central, 4), round(central * (1 + share), 4)]


def build_levers(store: Store, base_year: str, base_statement: dict, run: Run) -> dict:
    seed = json.loads((SEED / "levers.json").read_text())
    by_id = {l["id"]: l for l in seed["levers"]}
    first = lambda s, src: (lambda ps: store.idx[(s, ps[0], src)] if ps else None)(store.periods(s, src))
    last = lambda s, src: (lambda ps: store.idx[(s, ps[-1], src)] if ps else None)(store.periods(s, src))

    def from_hmrc(lever_id: str, slug: str, what: str, per: float = 1.0) -> None:
        """Set a lever from an HMRC reckoner row. `per` converts HMRC's step into the lever's unit (e.g. £100 to £1)."""
        y1, yn = first(f"reckoner.{slug}", "hmrc_reckoner"), last(f"reckoner.{slug}", "hmrc_reckoner")
        if y1 is None or lever_id not in by_id:
            run.add("coverage", "warning", f"lever {lever_id}", f"HMRC reckoner {slug} missing; keeping the template value")
            return
        l = by_id[lever_id]
        c1, cn = y1.value / per, yn.value / per
        l["effect"]["per_unit_bn"] = {"y1": sorted_range(ranged(c1, EDITORIAL_RANGE_HMRC)), "y5": sorted_range(ranged(cn, EDITORIAL_RANGE_HMRC))}
        step = f" per {per:g} of HMRC's step" if per != 1 else ""
        own = f" {y1.method_note}" if y1.quality != "sourced" and y1.method_note else ""
        l.update(quality=y1.quality, source_id="hmrc_reckoner",
                 method_note=f"HMRC direct effect of {what}: {y1.value:.3g}bn in {y1.period}, {yn.value:.3g}bn by {yn.period} ({y1.vintage}){step}. Low–high is an editorial ±{EDITORIAL_RANGE_HMRC:.0%} because HMRC publishes a central figure only. {HMRC_BEHAVIOUR}{own}")

    from_hmrc("income_tax_basic", "income_tax_basic_rate_1p", "1p on the basic rate of income tax")
    from_hmrc("income_tax_higher", "income_tax_higher_rate_1p", "1p on the higher rate of income tax")
    from_hmrc("income_tax_additional", "income_tax_additional_rate_1p", "1p on the additional rate of income tax")
    from_hmrc("personal_allowance", "personal_allowance_gbp100", "£100 on the personal allowance (shown per £1)", per=100)
    from_hmrc("nics_main", "nics_employee_main_rate_1pp", "1 point on the employee NICs main rate")
    from_hmrc("vat_standard", "vat_standard_rate_1pp", "1 point on the standard rate of VAT")
    from_hmrc("corp_tax", "corp_tax_main_rate_1pp", "1 point on the main rate of corporation tax")
    from_hmrc("fuel_duty", "fuel_duty_1p", "1p a litre on the main rate of fuel duty")

    # Bank Rate: OBR debt-interest sensitivity to short rates; base from the BoE.
    rate = bank_rate_base(store)
    short = [store.idx[("reckoner.debt_interest.short_rates_1pp", p, "obr_efo")] for p in store.periods("reckoner.debt_interest.short_rates_1pp", "obr_efo")]
    br = by_id["bank_rate"]
    br["base"] = rate.value
    if short:
        br["effect"]["per_unit_bn"] = {"y1": ranged(short[0].value, EDITORIAL_RANGE_OBR_RATES), "y5": ranged(short[-1].value, EDITORIAL_RANGE_OBR_RATES)}
        br.update(quality="sourced", source_id="obr_efo",
                  method_note=f"OBR ready reckoner: a 1 point rise in short-term interest rates adds {short[0].value:.2f}bn to debt interest in {short[0].period} and {short[-1].value:.2f}bn in {short[-1].period} ({short[0].vintage}). Gilt yields are held fixed. Low–high is an editorial ±{EDITORIAL_RANGE_OBR_RATES:.0%}.")

    # Tax-rate bases from GOV.UK, where the lever matches a published rate.
    tax_year = latest_tax_year(store)
    for lever_id, series in [
        ("income_tax_basic", "tax.income_tax.basic_rate"),
        ("income_tax_higher", "tax.income_tax.higher_rate"),
        ("income_tax_additional", "tax.income_tax.additional_rate"),
        ("personal_allowance", "tax.income_tax.personal_allowance"),
        ("nics_main", "tax.ni.main_rate"),
    ]:
        o = store.get(series, tax_year, ["govuk_tax_rates"]) if tax_year else None
        if o and lever_id in by_id:
            rebase(by_id[lever_id], o.value)
    fuel_rate = current_fuel_duty(store)
    if fuel_rate and "fuel_duty" in by_id:
        rebase(by_id["fuel_duty"], fuel_rate.value)
        scheduled = [store.idx[("tax.fuel_duty.main_rate", p, "govuk_tax_rates")] for p in store.periods("tax.fuel_duty.main_rate", "govuk_tax_rates") if p > date.today().isoformat()]
        ahead = "; ".join(f"{o.value:g}p from {o.period}" for o in scheduled)
        by_id["fuel_duty"]["method_note"] += f" Starting rate {fuel_rate.value:g}p a litre, in force since {fuel_rate.period} (GOV.UK)." + (f" Already scheduled: {ahead}." if ahead else "")

    # Spending levers: arithmetic on the base year's statement and GDP.
    lines = {l["id"]: l for l in base_statement["spending"]}
    gdp_bn = base_statement["macro"]["nominal_gdp_bn"]
    gdp_src = base_statement["macro"]["provenance"]["nominal_gdp_bn"]["source_id"]
    defence = by_id["defence_gdp"]
    nato = store.get("defence.nato_pct_gdp", base_year, ["nato_defence"])
    if "defence" in lines:
        per = round(gdp_bn / 100, 3)
        defence["effect"]["per_unit_bn"] = {"y1": [per, per, per]}
        cofog = lines["defence"]["bn"] / gdp_bn * 100
        if nato is not None:
            # Start from NATO's measure, the one politicians and NATO targets use (3.5% core defence).
            rebase(defence, round(nato.value, 2))
            # 0.01 steps so both today's figure (e.g. 2.32%) and round targets (2.5%, 3.5%) sit on the slider's grid.
            defence["step"] = 0.01
            estimate = " (a NATO estimate)" if nato.kind != "outturn" else ""
            defence.update(
                label="Defence, % of GDP (NATO measure)",
                quality="sourced",
                source_id="nato_defence",
                method_note=f"Starting point: UK defence spending on NATO's definition, {nato.value:.2f}% of GDP in {base_year}{estimate}, {nato.vintage}. "
                f"NATO counts more items than the UK's own COFOG figure ({lines['defence']['bn']:.1f}bn, {cofog:.2f}% of GDP). "
                f"Each point of GDP is {per:.1f}bn ({base_year} nominal GDP, as in the Statement), added to defence spending.",
            )
        else:
            rebase(defence, round(cofog, 1))
            defence.update(quality="approx", source_id=gdp_src,
                           method_note=f"Arithmetic: 1 point of GDP is {per:.1f}bn. Starting point is COFOG defence spending ({lines['defence']['bn']:.1f}bn) as a share of GDP; NATO's measure is not ingested, and it is higher.")
    if "health" in lines:
        per = round(lines["health"]["bn"] / 100, 3)
        by_id["health_change"]["effect"]["per_unit_bn"] = {"y1": [per, per, per]}
        by_id["health_change"].update(quality="approx" if lines["health"]["quality"] != "sourced" else "sourced", source_id="hmt_pesa",
                                      method_note=f"Arithmetic: 1% of the {base_year} health line ({lines['health']['bn']:.1f}bn, HMT PESA).")
    sp = store.get("spending.state_pension", base_year, ["dwp_benefits"])
    if sp:
        per = round(sp.value / 100, 3)
        by_id["state_pension_change"]["effect"]["per_unit_bn"] = {"y1": [per, per, per]}
        by_id["state_pension_change"].update(quality="sourced", source_id="dwp_benefits", method_note=f"Arithmetic: 1% of state pension spending in {base_year} ({sp.value:.1f}bn, {sp.vintage}).")

    # Bus cap funding option: 1p on fuel duty from HMRC.
    fuel = first("reckoner.fuel_duty_1p", "hmrc_reckoner")
    for opt in by_id["bus_cap_2"].get("funding_options", []):
        if opt["id"] == "fuel_duty" and fuel:
            opt.update(offset_bn=round(fuel.value, 3), quality=fuel.quality, source_id="hmrc_reckoner",
                       method_note=fuel.method_note or f"HMRC direct effect of 1p a litre on fuel duty: {fuel.value:.2f}bn in {fuel.period} ({fuel.vintage}).")

    seed["meta"]["note"] = "Sandbox coefficients built by etl/build.py from HMRC, OBR, HMT PESA and the base-year Statement. Ranges are editorial where the source gives a central figure only."
    seed["meta"]["sources"] = [s for s in seed["meta"]["sources"] if s["id"] not in ("hmrc_ready_reckoner", "obr_ready_reckoner")]
    return seed


def sorted_range(r: list[float]) -> list[float]:
    """A negative central figure (allowances) flips low and high; keep the range ordered."""
    return [min(r), r[1], max(r)]


def rebase(lever: dict, base: float) -> None:
    """Move a lever's starting point to a published value, keeping its width and step grid."""
    width_below, width_above = lever["base"] - lever["min"], lever["max"] - lever["base"]
    lever["base"] = base
    lever["min"] = round(base - width_below, 4)
    lever["max"] = round(base + width_above, 4)


def current_fuel_duty(store: Store):
    """The fuel duty main rate in force today (GOV.UK), if ingested."""
    periods = [p for p in store.periods("tax.fuel_duty.main_rate", "govuk_tax_rates") if p <= date.today().isoformat()]
    return store.idx[("tax.fuel_duty.main_rate", periods[-1], "govuk_tax_rates")] if periods else None


HMRC_BEHAVIOUR = "HMRC includes taxpayers' own behavioural response where it models one, but no wider economic effects."


def latest_tax_year(store: Store) -> str | None:
    years = store.periods("tax.income_tax.personal_allowance", "govuk_tax_rates")
    return years[-1] if years else None


def build_tax(store: Store, run: Run) -> dict:
    seed = json.loads((SEED / "uk_tax_2025-26.json").read_text())
    year = latest_tax_year(store)
    if year is None:
        run.add("coverage", "warning", "tax", "GOV.UK tax rates missing; keeping the training file")
        return seed
    g = lambda s: store.get(s, year, ["govuk_tax_rates"])
    it = {
        "personal_allowance_gbp": g("tax.income_tax.personal_allowance").value,
        "allowance_taper_threshold_gbp": g("tax.income_tax.allowance_taper_threshold").value,
        "allowance_taper_rate": 0.5,
        "basic_band_gbp": g("tax.income_tax.basic_band").value,
        "additional_threshold_gbp": g("tax.income_tax.additional_threshold").value,
        "basic_rate_lever": "income_tax_basic",
        "higher_rate_pct": g("tax.income_tax.higher_rate").value,
        "additional_rate_pct": g("tax.income_tax.additional_rate").value,
        "higher_rate_lever": "income_tax_higher",
        "additional_rate_lever": "income_tax_additional",
        "personal_allowance_lever": "personal_allowance",
    }
    ni = {
        "primary_threshold_gbp": g("tax.ni.primary_threshold").value,
        "upper_earnings_limit_gbp": g("tax.ni.upper_earnings_limit").value,
        "main_rate_lever": "nics_main",
        "upper_rate_pct": g("tax.ni.upper_rate").value,
    }
    return {
        "meta": {
            "country": "UK",
            "tax_year": year,
            "geography": "England, Wales and Northern Ireland",
            "quality": "sourced",
            "method_note": f"GOV.UK 'Income Tax rates and Personal Allowances' and HMRC 'Rates and thresholds for employers' for {year}. The allowance falls by £1 for every £2 above the taper threshold, as GOV.UK states. National Insurance rates apply across the UK; Scotland sets its own income tax bands.",
            "intended_sources": ["https://www.gov.uk/income-tax-rates", "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027"],
        },
        "income_tax": it,
        "employee_ni": ni,
        "your_share_defaults": seed["your_share_defaults"],
    }


def source_entries(run: Run) -> list[dict]:
    """Every source the bundle cites: ETL sources plus the seed's media sources (the bus-cap announcement)."""
    out = []
    for sid, s in sorted(run.sources.items()):
        d = {"id": sid, "title": s.title, "publisher": s.publisher, "url": s.url}
        if s.licence:
            d["licence"] = s.licence
        if s.published_on:
            d["published_on"] = s.published_on.isoformat()
        out.append(d)
    seed_levers = json.loads((SEED / "levers.json").read_text())
    for s in seed_levers["meta"]["sources"]:
        if s["id"] not in run.sources and s["publisher"] == "Media":
            out.append(s)
    return out


def assemble_all(store: Store, run: Run) -> dict:
    today = date.today()
    years = statement_years_all(store)
    ended = [y for y in years if year_ended(y, today)]
    base_year = ended[-1] if ended else years[0]
    paths = baseline_paths(store, base_year)
    sources = source_entries(run)
    by_id = {s["id"]: s for s in sources}

    statements: dict[str, dict] = {}
    index = []
    for y in years:
        body = assemble_year(store, y, run, today)
        macro = macro_for(store, y, paths, run, body["family"] if body else "obr_efo")
        if body is None or not macro:
            continue
        used = [by_id[sid] for sid in body["used"] + ["boe_bank_rate", "ons_households", "ons_population", "hmrc_taxpayers"] if sid in by_id]
        used = list({s["id"]: s for s in used}.values())
        plugs = [l["label"] for l in body["receipts"] + body["spending"] if l.get("plug")]
        statements[y] = {
            "meta": {
                "country": "UK",
                "fiscal_year": y,
                "vintage": " + ".join(body["vintages"]),
                "vintage_label": vintage_label(store, body),
                "note": f"Receipts from {body['family'].replace('_', ' ').upper()}; spending by function from HMT PESA ({body['functions_from']}); debt interest and totals as published.",
                "sources": used,
                "kind": body["kind"],
                **({"plugs": f"Balancing figures: {', '.join(plugs)}."} if plugs else {}),
            },
            "macro": macro,
            "receipts": body["receipts"],
            "borrowing_bn": body["borrowing_bn"],
            "borrowing_provenance": body["borrowing_provenance"],
            "spending": body["spending"],
        }
        index.append({"period": y, "kind": body["kind"]})

    if base_year in statements:
        anchor_paths(statements, base_year)
    if base_year not in statements:
        run.add("coverage", "error", base_year, "no statement for the base year")
        return {"statements": {}, "years": [], "base_year": base_year, "levers": {}, "tax": {}, "sources": sources}
    return {
        "statements": statements,
        "years": index,
        "base_year": base_year,
        "levers": build_levers(store, base_year, statements[base_year], run),
        "tax": build_tax(store, run),
        "sources": sources,
    }


def anchor_paths(statements: dict[str, dict], base_year: str) -> None:
    """
    Start the debt path at the base year's own figures. When the base year is
    outturn, its borrowing and debt ratio replace the OBR estimate for that year;
    later years stay as the OBR forecast. The KPI strip and the fan chart then agree.
    """
    base = statements[base_year]
    if base["meta"]["kind"] != "outturn":
        return
    psnb, psnd_pct = base["borrowing_bn"], base["macro"]["psnd_pct_gdp"]
    for s in statements.values():
        m = s["macro"]
        if base_year in m["baseline_psnb_bn"]:
            m["baseline_psnb_bn"] = {**m["baseline_psnb_bn"], base_year: psnb}
            m["baseline_psnd_pct_gdp"] = {**m["baseline_psnd_pct_gdp"], base_year: psnd_pct}
            note = f"{base_year}: outturn ({base['borrowing_provenance']['source_id']}, {base['macro']['provenance']['psnd_pct_gdp']['source_id']}); later years: OBR forecast."
            m["provenance"]["baseline_psnb_bn"] = {**m["provenance"]["baseline_psnb_bn"], "method_note": note}
            m["provenance"]["baseline_psnd_pct_gdp"] = {**m["provenance"]["baseline_psnd_pct_gdp"], "method_note": note}


def statement_years_all(store: Store) -> list[str]:
    years = set()
    for sid in RECEIPT_FAMILIES:
        years.update(store.periods("receipts.total", sid))
    return sorted(y for y in years if y >= FIRST_STATEMENT_YEAR)


def vintage_label(store: Store, body: dict) -> str:
    fam = body["family"]
    if fam == "obr_efo":
        v = next(v for v in body["vintages"] if v.startswith("EFO"))
        y, m = v.split("-")[1:3]
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        return f"OBR forecast, {months[int(m) - 1]} {y}"
    if fam == "ons_psf_receipts":
        v = next((v for v in body["vintages"] if v.startswith("PSF")), "")
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        return f"ONS outturn, {months[int(v[9:11]) - 1]} {v[4:8]} release" if len(v) >= 11 else "ONS outturn"
    return {"obr_databank": "OBR public finances databank"}.get(fam, fam)
