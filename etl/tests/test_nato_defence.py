import csv
import re

import pytest

from etl.core import ROOT, fiscal_year
from etl.sources import nato_defence as m

BUILD_OBS = ROOT / "data" / "build" / "observations"


@pytest.fixture(scope="module")
def raws(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the NATO files")
    return m.fetch()


@pytest.fixture(scope="module")
def obs(raws):
    return m.parse(raws)


@pytest.fixture(scope="module")
def xlsx(raws):
    return next(r for r in raws if r.path.suffix == ".xlsx")


def series(obs, sid):
    return {o.period: o for o in obs if o.series_id == sid}


def test_contract(obs):
    assert m.SOURCE.id == m.SOURCE_ID and m.SOURCE.cadence_days == 365 and m.SOURCE.grace_days == 60
    keys = [(o.series_id, o.period) for o in obs]
    assert keys == sorted(set(keys))
    assert {o.series_id for o in obs} == {m.PCT, m.GBP}
    for o in obs:
        assert o.geography == "UK" and o.source_id == m.SOURCE_ID and o.quality == "sourced"
        assert o.unit == {m.PCT: "pct_gdp", m.GBP: "gbp_bn"}[o.series_id]
        assert re.fullmatch(r"\d{4}-\d{2}", o.period) and fiscal_year(int(o.period[:4])) == o.period
        assert re.fullmatch(r"NATO-DE-\d{4}(-\d{2})?", o.vintage)


def test_latest_edition_found(raws, xlsx):
    found = m.editions(raws[0].path.read_text(errors="replace"))
    latest = found[0][0]
    assert latest >= 2026  # "Defence Investment of NATO Countries (2014-2026)", July 2026
    assert re.search(rf"def-exp-{latest}(-tables)?-en\.xlsx$", xlsx.url, re.I)
    assert xlsx.vintage.startswith(f"NATO-DE-{latest}")
    # The topic page's "2023" link points at the 2022 file: the year comes from the file name.
    assert all(re.search(rf"def-exp-{y}(-tables)?-en\.", u, re.I) for y, u in found)


def test_uk_share_of_gdp(obs, xlsx):
    pct = series(obs, m.PCT)
    edition = m.edition_year(xlsx)
    years = [int(p[:4]) for p in pct]
    assert years[-1] == edition  # latest year in the table, as a fiscal year
    assert set(range(2019, edition + 1)) <= set(years)
    for p, o in pct.items():
        if p >= "2019-20":
            assert 1.8 <= o.value <= 3.5, (p, o.value)


def test_estimates_flagged(obs):
    for sid in (m.PCT, m.GBP):
        s = list(series(obs, sid).values())
        kinds = [o.kind for o in s]
        assert kinds[-1] == "forecast" and "outturn" in kinds
        assert kinds == sorted(kinds, key=lambda k: k == "forecast")  # outturn years, then estimates
        for o in s:
            assert (o.kind == "forecast") == (o.method_note or "").startswith("NATO estimate")
            assert f"NATO's {o.period[:4]} is the UK fiscal year {o.period}" in o.method_note


def test_pounds_match_share(obs):
    pct, gbp = series(obs, m.PCT), series(obs, m.GBP)
    assert pct.keys() == gbp.keys()
    for p in pct:
        assert 30 <= gbp[p].value <= 150, (p, gbp[p].value)
        implied_gdp = gbp[p].value / pct[p].value * 100  # £bn
        assert 1500 <= implied_gdp <= 4500, (p, implied_gdp)


def test_share_is_current_price_share(xlsx):
    """Table 3 says 'share of real GDP, 2021 prices'; it equals Table 2 / Table 5 (current US dollars)."""
    t = m.uk_tables(xlsx.path)
    for (y, _), share, usd, gdp in zip(t["years"], t["pct_gdp"], t["usd_m"], t["gdp_usd_m"]):
        assert abs(usd / gdp * 100 - share) <= 0.006, (y, share, usd / gdp * 100)


def _build_value(source_id, sid, period):
    for f in sorted((BUILD_OBS / source_id).glob("*.csv")):
        with f.open() as fh:
            for row in csv.DictReader(fh):
                if row["series_id"] == sid and row["period"] == period:
                    return float(row["value"]), row["vintage"]
    return None


def test_compare_with_pesa_cofog(obs):
    """NATO counts more than COFOG defence, so its share of GDP should be higher."""
    year = "2025-26"
    cofog = _build_value("hmt_pesa", "spending.cofog.defence", year)
    gdp = _build_value("obr_databank", "macro.nominal_gdp", year)
    if not (cofog and gdp):
        pytest.skip("needs the built PESA and OBR observations in data/build")
    nato_pct, nato_gbp = series(obs, m.PCT)[year], series(obs, m.GBP)[year]
    cofog_pct = cofog[0] / gdp[0] * 100
    print(
        f"\n{year}: NATO {nato_pct.value:.2f}% of GDP, £{nato_gbp.value:.1f}bn ({nato_pct.kind}, {nato_pct.vintage}); "
        f"PESA COFOG defence £{cofog[0]:.1f}bn / OBR GDP £{gdp[0]:.1f}bn = {cofog_pct:.2f}% ({cofog[1]}, {gdp[1]}); "
        f"gap {nato_pct.value - cofog_pct:.2f} points, NATO share x OBR GDP = £{nato_pct.value * gdp[0] / 100:.1f}bn"
    )
    assert nato_pct.value > cofog_pct
    assert nato_gbp.value > cofog[0]
