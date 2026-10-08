"""
What /people reads (data/build/people.json): population and long-term spending
projections, from committed observations only, so the offline rebuild in CI
reproduces it byte for byte.

  ons_npp              ONS national population projections, principal and variants
  ons_mye_components   ONS mid-year estimates: past births and deaths
  obr_frs              OBR Fiscal risks and sustainability: age-related spending

We do not project anything ourselves (docs/MODEL.md T3). Two kinds of number are
worked out here, and each says so in its method note and is marked "approx":
  * people of working age per person over pension age: ONS working-age count
    divided by ONS pension-age count, for each variant and year;
  * age-related spending in an OBR scenario other than the baseline: OBR's
    baseline total plus the change the scenario makes, as OBR publishes it.
Every projected chart carries [low, central, high] per year: the lowest and highest
published high or low variant (or OBR scenario) and the principal projection (or
baseline). ONS's special cases (replacement fertility, zero net migration, no
mortality improvement) are kept out of the band: they illustrate a single
extreme assumption, and the page draws them only when a reader picks one.
"""

from __future__ import annotations

from etl.build import Run, Store
from etl.core import Observation

NPP = "ons_npp"
MYE = "ons_mye_components"
FRS = "obr_frs"
# The year whose assumptions describe each option (ONS sets its long-term assumptions "by mid-2049").
ASSUMPTION_YEAR = "2050"

# ONS's names for its variant projections (2024-based table of contents, "Variant code").
VARIANT_LABEL = {
    "ppp": "Principal projection",
    "hpp": "High fertility",
    "lpp": "Low fertility",
    "rpp": "Replacement fertility",
    "php": "High life expectancy",
    "plp": "Low life expectancy",
    "pnp": "No long-term mortality improvement",
    "pph": "High migration",
    "ppl": "Low migration",
    "ppz": "Zero net migration",
    "hhh": "High population",
    "lll": "Low population",
    "hlh": "Young age structure",
    "lhl": "Old age structure",
}
# Illustrative single-assumption extremes: selectable, but not part of the shaded range.
SPECIAL_CASES = {"rpp", "ppz", "pnp"}
LETTERS = (
    {"p": "principal", "h": "high", "l": "low", "r": "replacement"},
    {"p": "principal", "h": "high", "l": "low", "n": "no_improvement"},
    {"p": "principal", "h": "high", "l": "low", "z": "zero"},
)

# Assumption controls. Each option points at the variant that changes only that assumption.
ASSUMPTIONS = [
    {
        "id": "fertility",
        "label": "Fertility",
        "controlled_by": "demography",
        "options": [("low", "Low", "lpp"), ("principal", "Principal", "ppp"), ("high", "High", "hpp"), ("replacement", "Replacement", "rpp")],
        "measure": "tfr",
    },
    {
        "id": "migration",
        "label": "Net migration",
        "controlled_by": "demography",
        "options": [("zero", "Zero", "ppz"), ("low", "Low", "ppl"), ("principal", "Principal", "ppp"), ("high", "High", "pph")],
        "measure": "net_migration",
    },
    {
        "id": "life_expectancy",
        "label": "Life expectancy",
        "controlled_by": "demography",
        "options": [("no_improvement", "No improvement", "pnp"), ("low", "Low", "plp"), ("principal", "Principal", "ppp"), ("high", "High", "php")],
        "measure": "life_expectancy",
    },
]
SPA_NOTE = (
    "Neither the ONS nor the OBR publishes a projection with a different state pension age, so there is nothing to switch to. "
    "The ONS projections follow the law as it stands; the OBR baseline follows the government's stated plan."
)

# OBR scenarios: (series family, scenario id, label, who controls the assumption).
FRS_SCENARIOS = [
    ("primary", "higher_population", "Higher population", "demography"),
    ("health", "lower_healthy_life_expectancy", "Lower healthy life expectancy", "demography"),
    ("health", "higher_healthy_life_expectancy", "Higher healthy life expectancy", "demography"),
    ("primary", "no_extra_health_cost_pressures", "No extra cost pressures in health", "external"),
    ("primary", "cpi_uprating_welfare", "Benefits other than the state pension rise with prices", "government"),
    ("primary", "earnings_uprating_state_pension", "State pension rises with earnings, not the triple lock", "government"),
]
FRS_NOTE = {
    "primary": "Worked out from OBR figures: baseline age-related spending (Table 3.1) plus the change this scenario makes to total primary spending (Chart 3.12). Only age-related lines differ between these scenarios.",
    "health": "Worked out from OBR figures: baseline age-related spending (Table 3.1) plus the change this scenario makes to health spending (Chart 3.4). The OBR models it for health spending only, so other lines stay as in the baseline.",
}
FRS_LINES = [
    ("health", "Health"),
    ("adult_social_care", "Adult social care"),
    ("education", "Education"),
    ("state_pension", "State pension"),
    ("other_welfare", "Other welfare"),
    ("public_service_pensions", "Public service pensions"),
]
SUM_TOLERANCE = 0.05


def _prov(o: Observation, quality: str | None = None, note: str | None = None) -> dict:
    d = {"quality": quality or o.quality, "source_id": o.source_id, "vintage": o.vintage}
    if note or o.method_note:
        d["method_note"] = note or o.method_note
    return d


def _band(values: dict[str, list[float]], central: str, leave_out: set[str] = frozenset()) -> list[list[float]]:
    """[low, central, high] per index across the variants, except those left out."""
    n = len(values[central])
    inside = [v for k, v in values.items() if k not in leave_out]
    return [[round(min(v[i] for v in inside), 4), round(values[central][i], 4), round(max(v[i] for v in inside), 4)] for i in range(n)]


def npp_codes(store: Store) -> list[str]:
    codes = {s.split(".")[2] for (s, _p, sid) in store.idx if sid == NPP and s.startswith("people.npp.")}
    return sorted(codes, key=lambda c: (c != "ppp", list(VARIANT_LABEL).index(c) if c in VARIANT_LABEL else 99, c))


def npp_series(store: Store, code: str, measure: str, years: list[str]) -> list[float] | None:
    out = []
    for y in years:
        o = store.get(f"people.npp.{code}.{measure}", y, [NPP])
        if o is None:
            return None
        out.append(o.value)
    return out


def variants(store: Store, codes: list[str]) -> list[dict]:
    out = []
    for c in codes:
        d = {"code": c, "label": VARIANT_LABEL.get(c, c.upper()), "in_range": c not in SPECIAL_CASES}
        for i, (key, letters) in enumerate(zip(("fertility", "life_expectancy", "migration"), LETTERS)):
            d[key] = letters.get(c[i], "other")
        out.append(d)
    return out


def assumption_detail(store: Store, measure: str, code: str) -> dict:
    """The number an option stands for, from the variant itself, in ASSUMPTION_YEAR."""
    if measure == "life_expectancy":
        m = store.get(f"people.npp.{code}.life_expectancy_male", ASSUMPTION_YEAR, [NPP])
        f = store.get(f"people.npp.{code}.life_expectancy_female", ASSUMPTION_YEAR, [NPP])
        if not (m and f):
            return {}
        return {"year": ASSUMPTION_YEAR, "male": round(m.value, 1), "female": round(f.value, 1), "unit": "years", **_prov(m)}
    o = store.get(f"people.npp.{code}.{measure}", ASSUMPTION_YEAR, [NPP])
    if o is None:
        return {}
    return {"year": ASSUMPTION_YEAR, "value": round(o.value, 2 if measure == "tfr" else 0), "unit": o.unit, **_prov(o)}


def assumptions(store: Store, codes: list[str], spa_ons: str | None) -> list[dict]:
    out = []
    for a in ASSUMPTIONS:
        options = []
        for value, label, code in a["options"]:
            if code not in codes:
                continue  # not published: no option to switch to
            options.append({"value": value, "label": label, "variant": code, "detail": assumption_detail(store, a["measure"], code)})
        out.append({"id": a["id"], "label": a["label"], "controlled_by": a["controlled_by"], "options": options})
    out.append({"id": "state_pension_age", "label": "State pension age", "controlled_by": "government", "options": [],
                "note": SPA_NOTE + (f" ONS: {spa_ons}" if spa_ons else "")})
    return out


def projected_chart(store: Store, codes: list[str], years: list[str], values: dict[str, list[float]], prov: dict, unit: str) -> dict:
    return {"unit": unit, "years": [int(y) for y in years], "variants": {c: [round(v, 4) for v in vals] for c, vals in values.items()},
            "range": _band(values, "ppp", SPECIAL_CASES), "provenance": prov}


def assemble_people(store: Store, run: Run, sources: list[dict]) -> dict:
    codes = npp_codes(store)
    if "ppp" not in codes:
        run.add("coverage", "error", "people", "no ONS principal projection (ons_npp ppp) in the committed observations")
        return {}
    years = store.periods("people.npp.ppp.oadr", NPP)
    base = store.get("people.npp.ppp.oadr", years[0], [NPP])
    missing = [c for c in codes if npp_series(store, c, "oadr", years) is None]
    for c in missing:
        run.add("coverage", "warning", f"people {c}", "variant lacks some years; left out of /people")
    codes = [c for c in codes if c not in missing]
    spa_ons = (base.method_note or "").split("ONS: ", 1)[1] if base and "ONS: " in (base.method_note or "") else None

    # Old-age dependency ratio: ONS's own measure, per 1,000 of working age, shown per 100.
    oadr = {c: [v / 10 for v in npp_series(store, c, "oadr", years)] for c in codes}
    oadr_prov = _prov(base, note="ONS: people of state pension age or over per 1,000 people of working age (16 up to state pension age), shown per 100." + (f" {spa_ons}" if spa_ons else ""))

    # People of working age per person over pension age: worked out from ONS counts.
    workers = {}
    for c in codes:
        wa, pa = npp_series(store, c, "working_age", years), npp_series(store, c, "pension_age", years)
        if wa is None or pa is None:
            continue
        workers[c] = [w / p for w, p in zip(wa, pa)]
    wa0 = store.get("people.npp.ppp.working_age", years[0], [NPP])
    workers_prov = _prov(wa0, quality="approx", note="Computed from ONS projections: people of working age (16 up to state pension age) divided by people at or over state pension age, for each variant and year." + (f" {spa_ons}" if spa_ons else ""))

    # Births and deaths: ONS estimates up to the latest mid-year, then the projections.
    vital = {}
    for measure, past_series in (("births", "people.births"), ("deaths", "people.deaths")):
        past_years = store.periods(past_series, MYE)
        past = [store.get(past_series, y, [MYE]) for y in past_years]
        last_past = past_years[-1] if past_years else years[0]
        proj_years = [y for y in store.periods(f"people.npp.ppp.{measure}", NPP) if y > last_past and y in years]
        vals = {c: v for c in codes if (v := npp_series(store, c, measure, proj_years)) is not None}
        p0 = store.get(f"people.npp.ppp.{measure}", proj_years[0], [NPP]) if proj_years else None
        vital[measure] = {
            "past": {"years": [int(y) for y in past_years], "values": [round(o.value, 3) for o in past],
                     **({"provenance": _prov(past[-1], note=f"ONS mid-year estimates: UK {measure} in the year to 30 June.")} if past else {})},
            **projected_chart(store, codes, proj_years, vals, _prov(p0, note=f"ONS {years[0]}-based projections: UK {measure} in the year to 30 June.") if p0 else {}, "persons_k"),
        }
        if not past:
            run.add("coverage", "warning", f"people {measure}", "no past values from ons_mye_components")

    return {
        "projection": {"source_id": NPP, "vintage": base.vintage, "base_year": int(years[0]), "last_year": int(years[-1])},
        "variants": variants(store, codes),
        "assumptions": assumptions(store, codes, spa_ons),
        "charts": {
            "oadr": projected_chart(store, codes, years, oadr, oadr_prov, "per_100"),
            "workers": projected_chart(store, codes, years, workers, workers_prov, "ratio"),
            "births": vital["births"],
            "deaths": vital["deaths"],
        },
        "spending": assemble_spending(store, run),
        "sources": [s for s in sources if s["id"] in (NPP, MYE, FRS)],
    }


def assemble_spending(store: Store, run: Run) -> dict:
    years = store.periods("frs.age_related.total", FRS)
    if not years:
        run.add("coverage", "error", "people spending", "no OBR age-related spending (obr_frs) in the committed observations")
        return {}
    total = [store.get("frs.age_related.total", y, [FRS]) for y in years]
    t0 = total[0]
    scenarios = [{"id": "baseline", "label": "Baseline", "controlled_by": None, "values": [round(o.value, 4) for o in total],
                  **_prov(t0, note="OBR baseline scenario, Table 3.1. The OBR shows this breakdown for these years only.")}]
    for family, sid, label, owner in FRS_SCENARIOS:
        vals = []
        for y, o in zip(years, total):
            s = store.get(f"frs.{family}.{sid}", y, [FRS])
            b = store.get(f"frs.{family}.baseline", y, [FRS])
            if s is None or b is None:
                vals = None
                break
            vals.append(round(o.value + s.value - b.value, 4))
        if vals is None:
            run.add("coverage", "warning", f"people spending {sid}", "scenario not published for every year of Table 3.1; left out")
            continue
        scenarios.append({"id": sid, "label": label, "controlled_by": owner, "values": vals, **_prov(t0, quality="approx", note=FRS_NOTE[family])})

    components = []
    for line, label in FRS_LINES:
        obs = [store.get(f"frs.age_related.{line}", y, [FRS]) for y in years]
        if any(o is None for o in obs):
            run.add("coverage", "warning", f"people spending {line}", "line missing for some years")
            continue
        components.append({"id": line, "label": label, "values": [round(o.value, 4) for o in obs]})
    for i, y in enumerate(years):
        gap = sum(c["values"][i] for c in components) - total[i].value
        if abs(gap) > SUM_TOLERANCE:
            run.add("mapping", "warning", f"people spending {y}", f"age-related lines sum to {gap:+.2f} points of GDP more than the published total", gap)
    by_year = {sid: s["values"] for sid, s in ((s["id"], s) for s in scenarios)}
    return {
        "unit": "pct_gdp",
        "years": years,
        "scenarios": scenarios,
        "range": _band(by_year, "baseline"),
        "components": components,
        "provenance": _prov(t0),
    }
