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


def test_defence_starts_from_nato_measure(outputs):
    by_id = {l["id"]: l for l in outputs["levers"]["levers"]}
    d = by_id["defence_gdp"]
    assert d["source_id"] == "nato_defence"
    assert d["quality"] == "sourced"
    # 3.5% (NATO core target) and 2.5% must sit on the slider's grid
    for target in (2.5, 3.5):
        steps = (target - d["min"]) / d["step"]
        assert abs(steps - round(steps)) < 1e-6


def test_new_m2_levers_from_hmrc_and_govuk(outputs):
    by_id = {l["id"]: l for l in outputs["levers"]["levers"]}
    for lever_id in ("income_tax_higher", "income_tax_additional", "personal_allowance", "fuel_duty"):
        assert by_id[lever_id]["source_id"] == "hmrc_reckoner"
        assert by_id[lever_id]["quality"] in ("sourced", "approx")
    assert by_id["personal_allowance"]["effect"]["per_unit_bn"]["y1"][1] < 0
    assert outputs["tax"]["income_tax"]["personal_allowance_lever"] == "personal_allowance"


def test_failed_fetch_keeps_the_recorded_edition(monkeypatch):
    """A source that cannot be fetched (OBR refuses GitHub's servers) keeps its committed data and its recorded title and date."""
    import types

    import etl.build as build
    from etl.core import Source

    declared = Source(id="obr_databank", title="OBR Public finances databank", publisher="Office for Budget Responsibility", url="https://obr.uk/data/", cadence_days=180)

    def refuse(_):
        raise RuntimeError("403 Forbidden")

    mod = types.SimpleNamespace(SOURCE=declared, fetch=refuse, parse=lambda raws: [])
    monkeypatch.setattr(build, "discover", lambda: [mod])
    recorded = build.manifest_sources()["obr_databank"]
    run = Run(build_id="test", started_at="2026-10-07T00:00:00Z", trigger="test")
    by_source = build.collect(run, offline=False)
    assert by_source["obr_databank"] == read_committed("obr_databank")
    assert run.sources["obr_databank"].published_on is not None
    assert str(run.sources["obr_databank"].published_on) == str(recorded["published_on"])
    assert any(c.level == "warning" and "403" in c.message for c in run.checks)
