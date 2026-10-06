"""ONS Families and households: parse the real spreadsheet (downloaded once, cached 20 h)."""

import pytest

from etl.sources import ons_households


@pytest.fixture(scope="module")
def obs(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the ONS families and households download")
    return ons_households.parse(ons_households.fetch(None))


def test_series_and_metadata(obs):
    assert {o.series_id for o in obs} == {"people.households"}
    assert {o.unit for o in obs} == {"households_m"}
    assert {o.kind for o in obs} == {"outturn"}
    assert {o.quality for o in obs} == {"sourced"}
    assert len({o.vintage for o in obs}) == 1 and obs[0].vintage.startswith("FH-20")
    assert ons_households.SOURCE.published_on is not None
    assert ons_households.SOURCE.cadence_days == 365 and ons_households.SOURCE.grace_days == 90


def test_coverage(obs):
    years = sorted(int(o.period) for o in obs)
    assert years[0] <= 1996
    assert years[-1] >= 2025
    assert years == list(range(years[0], years[-1] + 1))


def test_plausible_values(obs):
    by = {o.period: o.value for o in obs}
    for year, v in by.items():
        assert 22 < v < 32, year
    latest = by[max(by)]
    assert 28 < latest < 30.5            # seed placeholder was 28.6m
    # households grow slowly: no jump of more than 3% a year
    ys = sorted(by)
    for a, b in zip(ys, ys[1:]):
        assert abs(by[b] / by[a] - 1) < 0.03, (a, b)
    assert "confidence interval" in obs[-1].method_note
