"""
/people assembly (etl/people.py) over the stored fixtures, and over the committed
observations: the committed people.json is what the assembly produces.
"""

import json
from pathlib import Path

import pytest

from etl.build import Run, Store, discover, read_committed
from etl.core import BUILD_DIR, RawArtifact
from etl.people import assemble_people
from etl.sources import obr_frs, ons_mye_components, ons_npp

FIX = Path(__file__).parent / "fixtures"


def raw(source: str, path: Path, vintage: str | None = None) -> RawArtifact:
    return RawArtifact(source, "https://example.org/", path, "0" * 64, "2026-10-07T00:00:00+00:00", vintage=vintage)


SOURCES = [{"id": s, "title": s, "publisher": "x", "url": "https://example.org/"} for s in ("ons_npp", "ons_mye_components", "obr_frs", "obr_efo")]


@pytest.fixture(scope="module")
def people():
    npp = ons_npp.parse([raw("ons_npp", FIX / "ons_npp" / f"npp2024_{c}_uk_summary.xlsx") for c in ("ppp", "hpp")])
    mye = ons_mye_components.parse([raw("ons_mye_components", FIX / "ons_mye_components" / "myeb_2011_2025.xlsx")])
    frs = obr_frs.parse([raw("obr_frs", FIX / "obr_frs" / "frs_2026_07_chapter3.xlsx")])
    run = Run(build_id="test", started_at="test", trigger="test")
    out = assemble_people(Store({"ons_npp": npp, "ons_mye_components": mye, "obr_frs": frs}), run, SOURCES)
    out["_run"] = run
    return out


def ordered(r):
    return all(lo <= c <= hi for lo, c, hi in r)


def test_no_errors_and_only_its_own_sources(people):
    assert [c for c in people["_run"].checks if c.level == "error"] == []
    assert [s["id"] for s in people["sources"]] == ["ons_npp", "ons_mye_components", "obr_frs"]


def test_old_age_dependency_is_ons_measure_per_100(people):
    c = people["charts"]["oadr"]
    assert c["years"][0] == 2024 and c["unit"] == "per_100"
    assert c["variants"]["ppp"][0] == pytest.approx(27.968, abs=1e-3)
    assert c["provenance"]["quality"] == "sourced" and c["provenance"]["source_id"] == "ons_npp"
    assert ordered(c["range"])


def test_workers_per_pensioner_is_computed_and_says_so(people):
    c = people["charts"]["workers"]
    assert c["variants"]["ppp"][0] == pytest.approx(44296.4 / 12388.913, abs=1e-4)
    assert c["provenance"]["quality"] == "approx"
    assert c["provenance"]["method_note"].startswith("Computed from ONS projections")
    assert "16 up to state pension age" in c["provenance"]["method_note"]


def test_births_join_estimates_and_projections(people):
    b = people["charts"]["births"]
    assert b["past"]["years"][-1] == 2025 and b["past"]["provenance"]["source_id"] == "ons_mye_components"
    assert b["years"][0] == 2026  # projections start after the latest estimate
    assert b["provenance"]["source_id"] == "ons_npp"
    assert ordered(b["range"])


def test_assumption_options_only_for_published_variants(people):
    by_id = {a["id"]: a for a in people["assumptions"]}
    assert [o["value"] for o in by_id["fertility"]["options"]] == ["principal", "high"]
    assert by_id["fertility"]["controlled_by"] == "demography"
    assert by_id["state_pension_age"]["controlled_by"] == "government"
    assert by_id["state_pension_age"]["options"] == []


def test_spending_scenarios_add_the_published_change(people):
    s = people["spending"]
    assert s["years"][-1] == "2075-76"
    sc = {x["id"]: x for x in s["scenarios"]}
    base = sc["baseline"]["values"][-1]
    # Baseline age-related spending plus the higher population scenario's change in primary spending (51.766 - 48.647).
    assert sc["higher_population"]["values"][-1] == pytest.approx(base + 51.766 - 48.647, abs=2e-3)
    # Health-only scenario: plus its change in health spending (15.171 - 13.455).
    assert sc["lower_healthy_life_expectancy"]["values"][-1] == pytest.approx(base + 15.171 - 13.455, abs=2e-3)
    assert sc["baseline"]["quality"] == "sourced"
    assert {x["quality"] for x in s["scenarios"][1:]} == {"approx"}
    assert sc["cpi_uprating_welfare"]["controlled_by"] == "government"
    assert ordered(s["range"])
    total = [sum(c["values"][i] for c in s["components"]) for i in range(len(s["years"]))]
    assert total == pytest.approx(sc["baseline"]["values"], abs=0.05)


def test_committed_people_json_matches_the_committed_observations():
    path = BUILD_DIR / "people.json"
    if not path.exists():
        pytest.skip("no committed people.json yet")
    run = Run(build_id="test", started_at="test", trigger="test")
    by_source = {}
    for mod in discover():
        run.sources[mod.SOURCE.id] = mod.SOURCE
        by_source[mod.SOURCE.id] = read_committed(mod.SOURCE.id)
    committed = json.loads(path.read_text())
    out = assemble_people(Store(by_source), run, committed["sources"])
    assert json.loads(json.dumps(out)) == committed
