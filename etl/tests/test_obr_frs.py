"""OBR Fiscal risks and sustainability: parse a small stored copy of the chapter 3 workbook (no network)."""

from pathlib import Path

import openpyxl
import pytest

from etl.core import RawArtifact
from etl.sources import obr_frs

FIX = Path(__file__).parent / "fixtures" / "obr_frs" / "frs_2026_07_chapter3.xlsx"


def raw(path: Path = FIX) -> RawArtifact:
    return RawArtifact("obr_frs", "https://obr.uk/download/x/", path, "0" * 64, "2026-10-07T00:00:00+00:00")


@pytest.fixture(scope="module")
def obs():
    return obr_frs.parse([raw()])


def value(obs, series, period):
    return next(o.value for o in obs if o.series_id == series and o.period == period)


def test_age_related_lines_from_table_3_1(obs):
    assert value(obs, "frs.age_related.total", "2025-26") == pytest.approx(26.343, abs=1e-3)
    assert value(obs, "frs.age_related.total", "2075-76") == pytest.approx(34.550, abs=1e-3)
    assert value(obs, "frs.age_related.education", "2035-36") == pytest.approx(3.967, abs=1e-3)  # "Education2": footnote digit dropped
    assert value(obs, "frs.age_related.public_service_pensions", "2045-46") == pytest.approx(0.858, abs=1e-3)
    periods = sorted({o.period for o in obs if o.series_id == "frs.age_related.total"})
    assert periods == ["2025-26", "2030-31", "2035-36", "2045-46", "2055-56", "2065-66", "2075-76"]


def test_scenarios_from_the_charts(obs):
    ids = {o.series_id for o in obs}
    assert {"frs.primary.baseline", "frs.primary.higher_population", "frs.primary.cpi_uprating_welfare",
            "frs.primary.earnings_uprating_state_pension", "frs.primary.no_extra_health_cost_pressures"} <= ids
    assert {"frs.health.baseline", "frs.health.lower_healthy_life_expectancy", "frs.health.higher_healthy_life_expectancy"} <= ids
    assert value(obs, "frs.primary.higher_population", "2075-76") == pytest.approx(51.766, abs=1e-3)
    assert value(obs, "frs.health.lower_healthy_life_expectancy", "2075-76") == pytest.approx(15.171, abs=1e-3)


def test_kinds_and_provenance(obs):
    kinds = {o.period: o.kind for o in obs if o.series_id == "frs.age_related.total"}
    assert kinds["2025-26"] == "forecast" and kinds["2030-31"] == "forecast" and kinds["2035-36"] == "projection"
    assert {o.vintage for o in obs} == {"FRS-2026-07"}
    assert {o.unit for o in obs} == {"pct_gdp"}
    assert {o.quality for o in obs} == {"sourced"}


def test_a_missing_table_fails_the_parse(tmp_path):
    wb = openpyxl.load_workbook(FIX)
    del wb["C3.4"]
    path = tmp_path / FIX.name
    wb.save(path)
    with pytest.raises(ValueError, match="health spending under alternative population health assumptions"):
        obr_frs.parse([raw(path)])


def test_newest_edition_first():
    html = """
      <a href="https://obr.uk/frs/fiscal-risks-and-sustainability-september-2024/">2024</a>
      <a href="https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/">2026</a>
      <a href="https://obr.uk/frs/fiscal-risks-and-sustainability-july-2025/?x=1">2025</a>
      <a href="https://obr.uk/frs/fiscal-risks-report-july-2021/">2021</a>"""
    assert obr_frs.edition_candidates(html) == [
        "https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/",
        "https://obr.uk/frs/fiscal-risks-and-sustainability-july-2025/",
        "https://obr.uk/frs/fiscal-risks-and-sustainability-september-2024/",
    ]


def test_edition_page_names_its_chapter_3_workbook():
    url = "https://obr.uk/frs/fiscal-risks-and-sustainability-july-2026/"
    html = """<title>Fiscal risks and sustainability – July 2026 - Office for Budget Responsibility</title>
      <script>{"datePublished":"2026-07-07T08:42:33+00:00"}</script>
      <a href="https://obr.uk/download/july-2026-fiscal-risks-and-sustainability-charts-and-tables-chapter-2/?tmstv=1">2</a>
      <a href="https://obr.uk/download/july-2026-fiscal-risks-and-sustainability-charts-and-tables-chapter-3/?tmstv=1">3</a>"""
    ed = obr_frs.edition_from_page(url, html)
    assert ed.vintage == "FRS-2026-07"
    assert ed.title == "OBR Fiscal risks and sustainability – July 2026"
    assert str(ed.published_on) == "2026-07-07"
    assert ed.workbook == "https://obr.uk/download/july-2026-fiscal-risks-and-sustainability-charts-and-tables-chapter-3/"
    with pytest.raises(LookupError):
        obr_frs.edition_from_page(url, "<p>no workbooks</p>")
