"""
Tests over the assembled build, from committed observations only (no network):
the Statement balances every year, receipts lines add up, years are labelled,
levers covered by HMRC or the OBR carry no training values.
"""

import json

import pytest

from etl.assemble import assemble_all
from etl.build import Run, Store, read_committed, discover
from etl.core import BUILD_DIR


@pytest.fixture(scope="module")
def outputs():
    run = Run(build_id="test", started_at="test", trigger="test")
    by_source = {}
    for mod in discover():
        run.sources[mod.SOURCE.id] = mod.SOURCE
        by_source[mod.SOURCE.id] = read_committed(mod.SOURCE.id)
    if not any(by_source.values()):
        pytest.skip("no committed observations; run python -m etl.build first")
    out = assemble_all(Store(by_source), run)
    out["_run"] = run
    return out


def test_no_assembly_errors(outputs):
    errors = [c for c in outputs["_run"].checks if c.level == "error"]
    assert errors == []


def test_every_year_balances(outputs):
    for year, s in outputs["statements"].items():
        rec = sum(l["bn"] for l in s["receipts"])
        sp = sum(l["bn"] for l in s["spending"])
        assert abs(rec + s["borrowing_bn"] - sp) < 0.1, year


def test_years_run_from_2019_20_and_are_labelled(outputs):
    years = [y["period"] for y in outputs["years"]]
    assert years[0] == "2019-20"
    assert years == sorted(years)
    assert {y["kind"] for y in outputs["years"]} <= {"outturn", "estimate", "forecast"}
    assert outputs["base_year"] in years


def test_no_plugs_or_training_in_statements(outputs):
    for year, s in outputs["statements"].items():
        for line in s["receipts"] + s["spending"]:
            assert not line.get("plug"), (year, line["id"])
            assert line["quality"] != "training", (year, line["id"])


def test_levers_from_official_sources(outputs):
    by_id = {l["id"]: l for l in outputs["levers"]["levers"]}
    for lever_id, source in [("income_tax_basic", "hmrc_reckoner"), ("nics_main", "hmrc_reckoner"), ("vat_standard", "hmrc_reckoner"), ("corp_tax", "hmrc_reckoner"), ("bank_rate", "obr_efo")]:
        assert by_id[lever_id]["quality"] == "sourced"
        assert by_id[lever_id]["source_id"] == source
        lo, c, hi = by_id[lever_id]["effect"]["per_unit_bn"]["y1"]
        assert lo < c < hi


def test_committed_bundle_matches_assembly(outputs):
    path = BUILD_DIR / "app.json"
    if not path.exists():
        pytest.skip("no committed bundle yet")
    bundle = json.loads(path.read_text())
    assert bundle["base_year"] == outputs["base_year"]
    assert set(bundle["statements"]) == set(outputs["statements"])
