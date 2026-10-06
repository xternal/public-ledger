"""
HMRC ready reckoner: parse the real published files (downloaded once a day, or
read from data/raw with --offline) and check the coefficients the sandbox uses.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import timedelta

import httpx
import pandas as pd
import pytest

from etl import core
from etl.sources import hmrc_reckoner as mod


def _no_network(request):
    raise httpx.ConnectError("offline: not in data/raw", request=request)


@pytest.fixture(scope="module")
def raws(request):
    if not request.config.getoption("--offline"):
        return mod.fetch(None)
    offline_http = httpx.Client(transport=httpx.MockTransport(_no_network))
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod, "download", lambda *a, **k: core.download(*a, max_age=timedelta(days=3650), http=offline_http, **k))
        try:
            return mod.fetch(None)
        except httpx.ConnectError:
            pytest.skip("offline and HMRC reckoner files are not cached in data/raw")


@pytest.fixture(scope="module")
def obs(raws):
    return mod.parse(raws)


@pytest.fixture(scope="module")
def table(obs):
    t: dict[str, dict[str, float]] = defaultdict(dict)
    for o in obs:
        t[o.series_id.removeprefix("reckoner.")][o.period] = o.value
    return t


def _years(raws) -> list[str]:
    sheet = next(r for r in raws if r.path.suffix in mod.SHEET_SUFFIXES)
    df = mod._read_sheet(sheet.path)
    for row in df.values.tolist():
        cols = mod._year_columns(row)
        if len(cols) >= 2:
            return sorted(p for p, _ in cols.values())
    raise AssertionError("no year header")


def test_files_and_vintage(raws, obs):
    names = [r.path.name for r in raws]
    assert "content.json" in names and "bulletin.json" in names
    assert any(n.endswith(mod.SHEET_SUFFIXES) for n in names)
    for r in raws:
        assert re.fullmatch(r"[0-9a-f]{64}", r.sha256)
    assert {o.vintage for o in obs} == {r.vintage for r in raws if r.path.suffix in mod.SHEET_SUFFIXES}
    assert re.fullmatch(r"HMRC-DE-\d{4}-\d{2}", obs[0].vintage)
    assert mod.SOURCE.published_on is not None


def test_every_row_is_mapped(raws):
    sheet = next(r for r in raws if r.path.suffix in mod.SHEET_SUFFIXES)
    mod.parse_table(mod._read_sheet(sheet.path))
    assert mod.UNMAPPED == [], f"new or renamed HMRC rows need a slug in ROWS: {mod.UNMAPPED}"


def test_required_slugs_for_every_year(raws, table):
    years = _years(raws)
    assert len(years) >= 3
    starts = [int(y[:4]) for y in years]
    assert starts == list(range(starts[0], starts[0] + len(starts))), years
    for slug in (*mod.REQUIRED, "personal_allowance_1pct", "fuel_duty_1p"):
        assert sorted(table[slug]) == years, slug


def test_observation_fields(obs):
    for o in obs:
        assert o.unit == "gbp_bn" and o.kind == "forecast" and o.source_id == "hmrc_reckoner"
        assert o.series_id.startswith("reckoner.")
        assert o.quality == ("approx" if o.series_id == "reckoner.fuel_duty_1p" else "sourced")
        assert o.method_note
    assert len({(o.series_id, o.period) for o in obs}) == len(obs)


# Plausible bands, £bn per step, any year. Rates raise money; allowances cost it.
BANDS = {
    "income_tax_basic_rate_1p": (4.0, 12.0),
    "income_tax_higher_rate_1p": (0.8, 4.0),
    "income_tax_additional_rate_1p": (0.02, 1.0),
    "nics_employee_main_rate_1pp": (3.0, 8.0),
    "nics_employer_rate_1pp": (6.0, 16.0),
    "vat_standard_rate_1pp": (6.0, 12.0),
    "corp_tax_main_rate_1pp": (2.0, 6.0),
    "fuel_duty_petrol_1pct": (0.05, 0.25),
    "fuel_duty_diesel_1pct": (0.05, 0.25),
    "fuel_duty_1p": (0.25, 0.7),
    "personal_allowance_gbp100": (-2.0, -0.3),
    "income_tax_basic_rate_limit_1pct": (-1.5, -0.1),
}


@pytest.mark.parametrize("slug", sorted(BANDS))
def test_values_in_plausible_band(table, slug):
    lo, hi = BANDS[slug]
    for period, v in table[slug].items():
        assert lo <= v <= hi, (slug, period, v)


COSTS_WHEN_RAISED = re.compile(r"allowance|threshold|nil_rate_band|child_benefit|lower_profits_limit|basic_rate_limit|starting_rate_limit")


def test_rates_positive_allowances_negative(table):
    for slug, years in table.items():
        if slug.startswith(("cgt_", "sdlt_")):
            continue  # HMRC signs these itself; a small rise can lose money
        if COSTS_WHEN_RAISED.search(slug):
            assert all(v <= 0 for v in years.values()), (slug, years)
        else:
            assert all(v >= 0 for v in years.values()), (slug, years)


def test_internal_consistency(table):
    for y, basic in table["income_tax_basic_rate_1p"].items():
        assert basic > table["income_tax_higher_rate_1p"][y] > table["income_tax_additional_rate_1p"][y]
        assert table["vat_standard_rate_1pp"][y] > table["vat_reduced_rate_1pp"][y]
        both = table["fuel_duty_petrol_1pct"][y] + table["fuel_duty_diesel_1pct"][y]
        assert table["fuel_duty_1p"][y] == pytest.approx(both / 0.5795, rel=0.01)  # 52.95p + 5p in the June 2025 edition


def test_fuel_duty_rate_from_bulletin(raws):
    bulletin = next(r for r in raws if r.path.name == "bulletin.json")
    rate = mod.fuel_duty_rate_pence(json.loads(bulletin.path.read_text())["details"]["body"])
    assert rate is not None and 50 <= rate <= 70


def test_bulletin_says_behaviour_is_included(raws):
    """Guard the method note: if HMRC changes its stance on behaviour, the notes must change too."""
    bulletin = next(r for r in raws if r.path.name == "bulletin.json")
    text = " ".join(json.loads(bulletin.path.read_text())["details"]["body"].split())
    assert re.search(r"account for taxpayers.{0,3} behavioural responses", text)


def test_sign_rules_on_a_synthetic_table():
    head = ["Illustrative", "Current Estimate, financial year 2026 to 2027, £ million", "Current Estimate, financial year 2027 to 2028, £ million"]
    rows = [
        ["Direct effects of illustrative tax changes", None, None],
        head,
        ["Income Tax rates", None, None],
        ["Change basic rate by 1p", 7000, 8000],
        ["Increase additional rate by 1p (yield)", 100, 200],
        ["Decrease additional rate by 1p (cost)", 150, 250],
        ["Income Tax allowances and reliefs", None, None],
        ["Change personal allowance by £100", 800, "Neg"],
        ["Stamp duty land tax", None, None],
        ["Cut residential 12% marginal rate by 1 percentage point (Cost)", -10, 5],
        ["Something HMRC added", 1, 2],
        ["End of worksheet.", None, None],
    ]
    with pytest.warns(UserWarning, match="not mapped"):
        out = {(r["slug"], r["period"]): r for r in mod.parse_table(pd.DataFrame(rows))}
    assert out[("income_tax_basic_rate_1p", "2026-27")]["value_bn"] == 7.0
    assert out[("income_tax_additional_rate_1p", "2027-28")]["value_bn"] == 0.2
    assert out[("income_tax_additional_rate_1p_cut", "2026-27")]["value_bn"] == 0.15
    assert out[("personal_allowance_gbp100", "2026-27")]["value_bn"] == -0.8
    neg = out[("personal_allowance_gbp100", "2027-28")]
    assert neg["value_bn"] == 0.0 and neg["negligible"]
    assert out[("sdlt_residential_12pct_band_1pp_cut", "2026-27")]["value_bn"] == -0.01
    assert mod.UNMAPPED == [("Stamp duty land tax", "Something HMRC added")]
    mod.UNMAPPED.clear()
