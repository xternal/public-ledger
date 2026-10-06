import json
import re
import shutil
from dataclasses import replace
from datetime import date

import pytest

from etl.core import FISCAL_YEAR, ROOT
from etl.sources import govuk_tax_rates as m

SEED = ROOT / "data" / "seed"
SERIES = [f"tax.income_tax.{k}" for k in m.INCOME_TAX_KEYS] + [f"tax.ni.{k}" for k in m.NI_KEYS]
FUEL = "tax.fuel_duty.main_rate"


def _seed() -> tuple[str, dict]:
    tax = json.loads((SEED / "uk_tax_2025-26.json").read_text())
    levers = {lv["id"]: lv for lv in json.loads((SEED / "levers.json").read_text())["levers"]}
    it, ni = tax["income_tax"], tax["employee_ni"]
    return tax["meta"]["tax_year"], {
        "tax.income_tax.personal_allowance": it["personal_allowance_gbp"],
        "tax.income_tax.basic_rate": levers[it["basic_rate_lever"]]["base"],
        "tax.income_tax.basic_band": it["basic_band_gbp"],
        "tax.income_tax.higher_rate": it["higher_rate_pct"],
        "tax.income_tax.additional_threshold": it["additional_threshold_gbp"],
        "tax.income_tax.additional_rate": it["additional_rate_pct"],
        "tax.income_tax.allowance_taper_threshold": it["allowance_taper_threshold_gbp"],
        "tax.ni.primary_threshold": ni["primary_threshold_gbp"],
        "tax.ni.upper_earnings_limit": ni["upper_earnings_limit_gbp"],
        "tax.ni.main_rate": levers[ni["main_rate_lever"]]["base"],
        "tax.ni.upper_rate": ni["upper_rate_pct"],
    }


@pytest.fixture(scope="module")
def raws(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the GOV.UK files")
    return m.fetch()


@pytest.fixture(scope="module")
def obs(raws):
    return m.parse(raws)


def test_contract(obs):
    assert m.SOURCE.id == m.SOURCE_ID and m.SOURCE.cadence_days == 365 and m.SOURCE.grace_days == 60
    keys = [(o.series_id, o.period) for o in obs]
    assert len(keys) == len(set(keys))
    for o in obs:
        assert o.quality == "sourced" and o.source_id == m.SOURCE_ID and o.vintage
        if o.series_id == FUEL:
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", o.period) and o.unit == "pence_per_litre" and o.geography == "UK"
            continue
        assert o.series_id in SERIES and FISCAL_YEAR.match(o.period)
        assert o.geography == ("UK" if o.series_id.startswith("tax.ni.") else "England, Wales and NI")
        assert o.unit == ("pct" if o.series_id.endswith("_rate") else "gbp")


def test_all_thresholds_for_at_least_one_year(obs):
    by_year: dict[str, set] = {}
    for o in obs:
        if o.series_id == FUEL:
            continue
        by_year.setdefault(o.period, set()).add(o.series_id)
    complete = [y for y, s in by_year.items() if s == set(SERIES)]
    assert complete, f"no tax year has all {len(SERIES)} series: {by_year}"


def test_values_next_to_seed(obs):
    seed_year, seed = _seed()
    years = sorted({o.period for o in obs if o.series_id != FUEL})
    val = {(o.series_id, o.period): o.value for o in obs}
    lines = [f"{'series':42} {'seed ' + seed_year:>14} " + " ".join(f"{y:>10}" for y in years)]
    for s in SERIES:
        lines.append(f"{s:42} {seed[s]:>14,} " + " ".join(f"{val.get((s, y), float('nan')):>10,.0f}" for y in years))
    print("\n" + "\n".join(lines))
    for s in SERIES:
        if (s, seed_year) in val:
            assert val[(s, seed_year)] == seed[s], f"{s} {seed_year}: GOV.UK {val[(s, seed_year)]} vs seed {seed[s]}"


def test_fuel_duty(obs):
    fuel = sorted((o for o in obs if o.series_id == FUEL), key=lambda o: o.period)
    today = date.today().isoformat()
    in_force = [o for o in fuel if o.period <= today]
    assert in_force, "no fuel duty rate in force"
    cur = in_force[-1]
    assert cur.kind == "outturn" and 40 < cur.value < 80
    for o in fuel:
        assert o.kind == ("outturn" if o.period <= today else "forecast")
        if o.kind == "forecast":
            assert "Scheduled" in o.method_note
    seed = next(lv for lv in json.loads((SEED / "levers.json").read_text())["levers"] if lv["id"] == "fuel_duty")
    print(f"\nfuel duty main rate (seed lever base {seed['base']}p):")
    for o in fuel:
        print(f"  {o.period} {o.value:6.2f}p {o.kind:9} {o.method_note or ''}")


def _tampered(raws, tmp_path, name: str, *edits: tuple[str, str]):
    """Copies of the raw files with every occurrence of each `old` replaced in file `name`."""
    out = []
    for r in raws:
        if r.path.name == name:
            p = tmp_path / name
            shutil.copy(r.path, p)
            text = p.read_text(encoding="utf-8")
            for old, new in edits:
                assert old in text, old
                text = text.replace(old, new)
            p.write_text(text, encoding="utf-8")
            r = replace(r, path=p)
        out.append(r)
    assert any(r.path.parent == tmp_path for r in out), f"no raw file named {name}"
    return out


def test_parser_is_strict_on_missing_text(raws, tmp_path):
    bad = _tampered(raws, tmp_path, "income-tax-rates.json", ("standard Personal Allowance is", "standard allowance is"))
    with pytest.raises(ValueError, match="pattern"):
        m.parse(bad)


def test_parser_is_strict_on_disagreement(raws, tmp_path):
    """HMRC PAYE bands that join up but disagree with income-tax-rates must stop the parse."""
    year = sorted({o.period for o in m.parse(raws) if o.series_id != FUEL})[-1]
    start = int(year[:4])
    name = f"rates-and-thresholds-for-employers-{start}-to-{start + 1}.json"
    bad = _tampered(raws, tmp_path, name, ("Up to £37,700", "Up to £37,000"), ("From £37,701", "From £37,001"))
    with pytest.raises(ValueError, match="disagree"):
        m.parse(bad)


def test_fuel_duty_is_strict_on_disagreement(raws, tmp_path):
    """A rates-page start date the policy paper does not have must stop the parse."""
    bad = _tampered(raws, tmp_path, "excise-duty-hydrocarbon-oils-rates.json",
                    ("From 23 March 2022 (pounds per litre)", "From 1 April 2026 (pounds per litre)"))
    with pytest.raises(ValueError, match="disagree"):
        m.parse(bad)
