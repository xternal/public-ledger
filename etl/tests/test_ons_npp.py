"""ONS national population projections: parse small stored copies of the real workbooks (no network)."""

from datetime import date
from pathlib import Path

import pytest

from etl.core import RawArtifact
from etl.sources import ons_npp

FIX = Path(__file__).parent / "fixtures" / "ons_npp"
VINTAGE = "NPP-2024based-2026-04-28"


def raw(name: str, vintage: str | None = VINTAGE) -> RawArtifact:
    return RawArtifact("ons_npp", f"https://www.ons.gov.uk/file?uri=/x/{name}", FIX / name, "0" * 64, "2026-10-07T00:00:00+00:00", vintage=vintage)


@pytest.fixture(scope="module")
def obs():
    return ons_npp.parse([raw("npp2024_ppp_uk_summary.xlsx"), raw("npp2024_hpp_uk_summary.xlsx")])


def by(obs, series, period):
    return next(o for o in obs if o.series_id == series and o.period == period)


def test_series_for_each_variant(obs):
    ids = {o.series_id for o in obs}
    for code in ("ppp", "hpp"):
        for measure in ons_npp.ROWS:
            assert f"people.npp.{code}.{measure}" in ids
    assert {o.source_id for o in obs} == {"ons_npp"}
    assert {o.quality for o in obs} == {"sourced"}
    assert {o.vintage for o in obs} == {VINTAGE}


def test_values_read_by_label_and_year(obs):
    assert by(obs, "people.npp.ppp.births", "2025").value == pytest.approx(651.892, abs=1e-3)
    assert by(obs, "people.npp.ppp.deaths", "2026").value == pytest.approx(665.767, abs=1e-3)
    assert by(obs, "people.npp.ppp.net_migration", "2027").value == 230
    assert by(obs, "people.npp.ppp.working_age", "2024").value == pytest.approx(44296.4, abs=1e-3)
    assert by(obs, "people.npp.ppp.pension_age", "2024").value == pytest.approx(12388.913, abs=1e-3)
    assert by(obs, "people.npp.ppp.oadr", "2024").value == pytest.approx(279.682, abs=1e-3)
    assert by(obs, "people.npp.ppp.population", "2024").value == pytest.approx(69281.437, abs=1e-3)
    # A variant differs where its assumption bites: more births with high fertility.
    assert by(obs, "people.npp.hpp.births", "2027").value > by(obs, "people.npp.ppp.births", "2027").value


def test_base_year_is_an_estimate_with_the_pension_age_note(obs):
    base = by(obs, "people.npp.ppp.pension_age", "2024")
    assert base.kind == "outturn"
    assert "State Pension Age" in base.method_note and "68" in base.method_note
    assert by(obs, "people.npp.ppp.pension_age", "2025").kind == "projection"
    # Table 1 has no components for the base year.
    assert not [o for o in obs if o.series_id == "people.npp.ppp.births" and o.period == "2024"]


def test_years_stop_at_the_obr_horizon(obs):
    assert max(int(o.period) for o in obs) <= ons_npp.LAST_YEAR
    assert not [o for o in obs if o.period == "2076"]


def test_vintage_from_the_cover_sheet_when_not_fetched():
    out = ons_npp.parse([raw("npp2024_ppp_uk_summary.xlsx", vintage=None)])
    assert {o.vintage for o in out} == {VINTAGE}


def test_needs_the_principal_projection():
    with pytest.raises(ValueError, match="principal"):
        ons_npp.parse([raw("npp2024_hpp_uk_summary.xlsx")])


def test_rejects_unexpected_file_names(tmp_path):
    p = tmp_path / "ukpppsummary.xlsx"
    p.write_bytes((FIX / "npp2024_ppp_uk_summary.xlsx").read_bytes())
    with pytest.raises(ValueError, match="file name"):
        ons_npp.code_of(p)


def test_table_of_contents_lists_every_variant():
    published, pages = ons_npp.toc_summary_pages(FIX / "npp2024_toc.xlsx")
    assert published == date(2026, 4, 28)
    assert {"ppp", "hpp", "lpp", "php", "plp", "pph", "ppl", "ppz", "hhh", "lll", "hlh", "lhl", "rpp", "pnp"} <= set(pages)
    assert pages["ppp"].endswith("/datasets/tablea11principalprojectionuksummary")


def test_newest_full_edition_of_the_table_of_contents():
    base = "/file?uri=/peoplepopulationandcommunity/populationandmigration/populationprojections/datasets/2014basednationalpopulationprojectionstableofcontents"
    html = f"""
      <a href="{base}/ppuwebindex.xls">2014</a>
      <a href="{base}/2021basedinterimnationalpopulationprojectionstableofcontentseditionofthisdataset/x.xls">2021 interim</a>
      <a href="{base}/2024basednationalpopulationprojectionstableofcontents/2024basednationalpopulationprojectionstableofcontents.xlsx">2024</a>
      <a href="{base}/2022basednationalpopulationprojectionstableofcontents/2022basednationalpopulationprojectionstableofcontents.xls">2022</a>"""
    eds = ons_npp.toc_editions(html)
    assert [b for b, _ in eds] == [2024, 2022, 2021, 2014]
    assert eds[0][1].startswith("https://www.ons.gov.uk/file?uri=") and eds[0][1].endswith("2024basednationalpopulationprojectionstableofcontents.xlsx")


def test_edition_file_on_a_dataset_page():
    page = "https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationprojections/datasets/tablea11principalprojectionuksummary"
    html = """
      <a href="/file?uri=/x/tablea11principalprojectionuksummary/2022based/ukpppsummary.xlsx">2022</a>
      <a href="/file?uri=/x/tablea11principalprojectionuksummary/2024based/ukpppsummary.xlsx">2024</a>"""
    assert ons_npp.edition_file(html, page, 2024).endswith("/2024based/ukpppsummary.xlsx")
    assert ons_npp.edition_file(html, page, 2026) is None
