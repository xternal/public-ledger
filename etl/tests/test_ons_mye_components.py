"""ONS mid-year estimates, past UK births and deaths: parse a small stored copy of table MYEB5 (no network)."""

from pathlib import Path

import pytest

from etl.core import RawArtifact
from etl.sources import ons_mye_components as mye

FIX = Path(__file__).parent / "fixtures" / "ons_mye_components" / "myeb_2011_2025.xlsx"


@pytest.fixture(scope="module")
def obs():
    return mye.parse([RawArtifact("ons_mye_components", "https://www.ons.gov.uk/file?uri=/x.xlsx", FIX, "0" * 64, "2026-10-07T00:00:00+00:00")])


def test_uk_births_and_deaths_in_thousands(obs):
    v = {(o.series_id, o.period): o.value for o in obs}
    assert v[("people.births", "2012")] == pytest.approx(813.191)
    assert v[("people.deaths", "2012")] == pytest.approx(562.108)
    assert v[("people.births", "2025")] == pytest.approx(652.441)
    assert v[("people.deaths", "2025")] == pytest.approx(647.532)
    # The UK row, not Great Britain's (which comes next and is smaller).
    assert len([o for o in obs if o.period == "2025"]) == 2


def test_provenance(obs):
    assert {o.vintage for o in obs} == {"MYEB-2026-10-01"}
    assert {o.kind for o in obs} == {"outturn"}
    assert {o.unit for o in obs} == {"persons_k"}
    assert all("year to mid-" in o.method_note for o in obs)


def test_newest_time_series_on_the_dataset_page():
    base = "/file?uri=/peoplepopulationandcommunity/populationandmigration/populationestimates/datasets/populationestimatesforukenglandandwalesscotlandandnorthernireland"
    html = f"""
      <a href="{base}/mid2011tomid2024/myebtablesuk20112024.xlsx">2024</a>
      <a href="{base}/mid2011tomid2025/myebtablesuk20112025.xlsx">2025</a>
      <a href="{base}/mid2025/mye25tablesuk.xlsx">mid-2025 only</a>"""
    year, url = mye.latest_time_series(html)
    assert year == 2025 and url.endswith("/mid2011tomid2025/myebtablesuk20112025.xlsx")
    with pytest.raises(LookupError):
        mye.latest_time_series("<a href='/nothing.xlsx'>x</a>")
