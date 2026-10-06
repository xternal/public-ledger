"""ONS mid-year population estimates: parse the real UKPOP CSV (downloaded once, cached 20 h)."""

import pytest

from etl.sources import ons_population


@pytest.fixture(scope="module")
def obs(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the ONS UKPOP download")
    return ons_population.parse(ons_population.fetch(None))


def test_series_and_metadata(obs):
    assert {o.series_id for o in obs} == {"people.population"}
    assert {o.unit for o in obs} == {"persons_m"}
    assert {o.kind for o in obs} == {"outturn"}
    assert {o.quality for o in obs} == {"sourced"}
    assert len({o.vintage for o in obs}) == 1 and obs[0].vintage.startswith("MYE-20")
    assert ons_population.SOURCE.published_on is not None
    assert ons_population.SOURCE.cadence_days == 365 and ons_population.SOURCE.grace_days == 90


def test_coverage(obs):
    years = sorted(int(o.period) for o in obs)
    assert years[0] <= 1971
    assert years[-1] >= 2025
    assert years == list(range(years[0], years[-1] + 1))


def test_plausible_values(obs):
    by = {o.period: o.value for o in obs}
    assert 55 < by["1971"] < 57
    assert 66 < by["2019"] < 67.5
    latest = by[max(by)]
    assert 68.5 < latest < 71            # seed placeholder was 69.3m
    ys = sorted(by)
    for a, b in zip(ys, ys[1:]):
        assert abs(by[b] / by[a] - 1) < 0.02, (a, b)
    assert "provisional" in [o for o in obs if o.period == max(by)][0].method_note


def test_rejects_other_series(tmp_path):
    p = tmp_path / "x.csv"
    p.write_text('"Title","x"\n"CDID","ENPOP"\n"Release date","01-10-2026"\n"2025","1"\n')
    with pytest.raises(ValueError):
        ons_population.read(p)
