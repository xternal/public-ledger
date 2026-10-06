"""ONS Public sector finances: parse the real PUSF CSV (downloaded once, cached 20 h)."""

from collections import defaultdict

import pytest

from etl.core import Observation
from etl.sources import ons_psf

FYS = ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]


@pytest.fixture(scope="module")
def obs(request) -> list[Observation]:
    if request.config.getoption("--offline"):
        pytest.skip("needs the ONS PUSF download")
    raws = ons_psf.fetch(None)
    return ons_psf.parse(raws)


@pytest.fixture(scope="module")
def by(obs) -> dict[str, dict[str, Observation]]:
    d: dict[str, dict[str, Observation]] = defaultdict(dict)
    for o in obs:
        assert o.period not in d[o.series_id], f"duplicate {o.series_id} {o.period}"
        d[o.series_id][o.period] = o
    return d


def test_vintage_and_metadata(obs):
    assert {o.vintage for o in obs} == {obs[0].vintage}
    assert obs[0].vintage.startswith("PSF-20")
    assert {o.source_id for o in obs} == {"ons_psf"}
    assert {o.kind for o in obs} == {"outturn"}
    assert ons_psf.SOURCE.published_on is not None
    assert ons_psf.SOURCE.cadence_days == 31 and ons_psf.SOURCE.grace_days == 10


def test_core_fiscal_year_series_present(by):
    for sid in ["fiscal.psnb", "receipts.total", "spending.tme", "spending.debt_interest", "fiscal.psnd", "fiscal.psnd_pct_gdp"]:
        missing = [fy for fy in FYS if fy not in by[sid]]
        assert not missing, f"{sid} missing {missing}"
        # completed years only: nothing after the last full April-March year
        assert max(by[sid]) >= "2025-26"


def test_monthly_series_present(by):
    for sid in ["psf.psnb_ex", "psf.pscr_ex", "psf.tme_ex", "psf.cg_debt_interest", "psf.psnd_ex", "psf.psnd_ex_pct_gdp"]:
        periods = sorted(by[sid])
        assert periods[0] == "2019-04", sid
        assert periods[-1] >= "2026-08", sid
        assert all(len(p) == 7 and 1 <= int(p[5:]) <= 12 for p in periods)
        assert {o.unit for o in by[sid].values()} == ({"pct_gdp"} if sid.endswith("pct_gdp") else {"gbp_bn"})


def _months(fy: str) -> list[str]:
    s = int(fy[:4])
    return [f"{s}-{m:02d}" for m in range(4, 13)] + [f"{s + 1}-{m:02d}" for m in range(1, 4)]


@pytest.mark.parametrize("fy_series,monthly", [
    ("fiscal.psnb", "psf.psnb_ex"),
    ("receipts.total", "psf.pscr_ex"),
    ("spending.tme", "psf.tme_ex"),
    ("spending.debt_interest", "psf.cg_debt_interest_net_apf"),
])
def test_fiscal_year_equals_sum_of_months(by, fy_series, monthly):
    for fy in FYS:
        total = sum(by[monthly][m].value for m in _months(fy))
        assert by[fy_series][fy].value == pytest.approx(total, abs=0.05), fy


def test_stocks_are_end_march(by):
    for fy in FYS:
        end = f"{int(fy[:4]) + 1}-03"
        assert by["fiscal.psnd"][fy].value == by["psf.psnd_ex"][end].value
        assert by["fiscal.psnd_pct_gdp"][fy].value == by["psf.psnd_ex_pct_gdp"][end].value


def test_borrowing_identity(by):
    # PSNB ex = TME ex - PSCR ex, exactly in the ONS data (rounding only).
    for fy in FYS:
        gap = by["spending.tme"][fy].value - by["receipts.total"][fy].value - by["fiscal.psnb"][fy].value
        assert abs(gap) < 0.05, fy


def test_plausible_bands(by):
    for fy in FYS:
        assert 30 < by["fiscal.psnb"][fy].value < 350, fy          # 2020-21 peak ~311bn
        assert 700 < by["receipts.total"][fy].value < 1500, fy
        assert 800 < by["spending.tme"][fy].value < 1600, fy
        assert 15 < by["spending.debt_interest"][fy].value < 150, fy
        assert 1700 < by["fiscal.psnd"][fy].value < 3300, fy
        assert 75 < by["fiscal.psnd_pct_gdp"][fy].value < 110, fy
    # 2025-26 against the OBR March 2026 forecast the seed uses (PSNB 132.7, PSCR 1,235, DI 110, PSND 94.3%)
    assert 110 < by["fiscal.psnb"]["2025-26"].value < 160
    assert 1180 < by["receipts.total"]["2025-26"].value < 1290
    assert 95 < by["spending.debt_interest"]["2025-26"].value < 125
    assert 88 < by["fiscal.psnd_pct_gdp"]["2025-26"].value < 100


def test_debt_interest_definitions(by):
    # Net of APF = gross CG interest payable minus APF net interest receivable; APF has lost money since 2022-23.
    for fy in ["2022-23", "2023-24", "2024-25", "2025-26"]:
        assert by["spending.debt_interest"][fy].value > by["spending.cg_interest_payable"][fy].value
    assert by["spending.debt_interest"]["2025-26"].quality == "approx"
    assert by["spending.debt_interest"]["2025-26"].method_note
    assert by["fiscal.psnb"]["2025-26"].quality == "sourced"
    assert "Sum of the 12 monthly values" in by["fiscal.psnb"]["2025-26"].method_note


def test_title_check_rejects_redefined_cdid(tmp_path):
    rows = [
        ["Title", "something else"],
        ["CDID", "DZLS"],
        ["Release Date", "22-09-2026"],
    ]
    with pytest.raises(ValueError):
        ons_psf.read_series(rows)
