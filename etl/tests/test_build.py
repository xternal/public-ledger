"""
Tests over the assembled build, from committed observations only (no network):
the Statement balances every year, receipts lines add up, years are labelled,
levers covered by HMRC or the OBR carry no training values.
"""

import json

import pytest

from etl.assemble import assemble_all
from etl.build import Run, Store, read_committed, discover
from etl.core import BUILD_DIR, ROOT


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


# HMRC, Direct effects of illustrative tax changes (June 2025), £ million, change made in April 2026:
# {step: (2026-27, 2028-29)}. Minus = the Treasury collects less.
HMRC_CGT = {
    "cgt_lower": {1: (-5, 5), 5: (-40, -10), 10: (-130, -135)},
    "cgt_higher": {1: (-15, -30), 5: (-170, -870), 10: (-540, -3565)},
}


def test_cgt_levers_use_hmrcs_own_steps(outputs):
    by_id = {l["id"]: l for l in outputs["levers"]["levers"]}
    for lever_id, want in HMRC_CGT.items():
        l = by_id[lever_id]
        assert l["quality"] == "sourced" and l["source_id"] == "hmrc_reckoner" and l["effect"]["target"] == "cgt"
        assert "per_unit_bn" not in l["effect"]
        steps = l["effect"]["steps"]
        assert [s["at"] for s in steps] == [1, 5, 10]
        assert l["min"] == l["base"] and l["max"] == l["base"] + 10
        for s in steps:
            y1, y5 = want[s["at"]]
            assert s["y1"][1] == pytest.approx(y1 / 1000) and s["y5"][1] == pytest.approx(y5 / 1000)
            for r in (s["y1"], s["y5"]):
                assert r[0] <= r[1] <= r[2]
                assert r[0] == pytest.approx(r[1] * 1.1 if r[1] < 0 else r[1] * 0.9)
        note = l["method_note"]
        assert "are also non-linear and so cannot be scaled up" in note and "only steps" in note
        assert "−£540m in 2026-27" in note if lever_id == "cgt_higher" else "−£130m in 2026-27" in note
    # Bases from GOV.UK; the higher rate is 16 points short of income tax's 40%, beyond HMRC's last step.
    assert by_id["cgt_lower"]["base"] == 18 and by_id["cgt_higher"]["base"] == 24
    assert "would need a rise of 16 points, bigger than any HMRC estimates" in by_id["cgt_higher"]["method_note"]
    assert "would need a rise of 2 points, which is not one of HMRC's steps" in by_id["cgt_lower"]["method_note"]


def test_cgt_lever_keeps_the_template_when_a_step_is_missing():
    run = Run(build_id="test", started_at="test", trigger="test")
    by_source = {}
    for mod in discover():
        run.sources[mod.SOURCE.id] = mod.SOURCE
        by_source[mod.SOURCE.id] = read_committed(mod.SOURCE.id)
    by_source["hmrc_reckoner"] = [o for o in by_source["hmrc_reckoner"] if o.series_id != "reckoner.cgt_higher_rate_5pp"]
    by_id = {l["id"]: l for l in assemble_all(Store(by_source), run)["levers"]["levers"]}
    template = next(l for l in json.loads((ROOT / "data" / "seed" / "levers.json").read_text())["levers"] if l["id"] == "cgt_higher")
    assert by_id["cgt_higher"]["effect"] == template["effect"]
    assert by_id["cgt_higher"]["quality"] == "training"
    assert any(c.check_id == "coverage" and c.level == "warning" and "cgt_higher_rate_5pp missing" in c.message for c in run.checks)
    assert by_id["cgt_lower"]["quality"] == "sourced"


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


# ---------------------------------------------------------------- editions on disk (network-free)


def _edition(vintage: str, values: dict[str, float], source_id: str = "toy") -> list:
    from etl.core import Observation

    return [Observation(series_id="macro.toy", period=p, value=v, unit="pct", kind="outturn", source_id=source_id, vintage=vintage, quality="sourced")
            for p, v in values.items()]


@pytest.fixture
def obs_dir(monkeypatch, tmp_path):
    import etl.build as build

    monkeypatch.setattr(build, "OBS_DIR", tmp_path)
    return tmp_path / "toy"


def test_a_relabelled_edition_is_not_written(obs_dir):
    """Same numbers under a new label (a technical republish, a label dated by the fetch) add no file."""
    from etl.build import write_observations

    assert write_observations("toy", _edition("TOY-2026-09-17", {"2025": 1.0, "2026": 2.0})) == {}
    assert write_observations("toy", _edition("TOY-2026-10-06", {"2025": 1.0, "2026": 2.0})) == {"TOY-2026-10-06": "TOY-2026-09-17"}
    assert sorted(p.name for p in obs_dir.iterdir()) == ["TOY-2026-09-17.csv"]

    assert write_observations("toy", _edition("TOY-2026-11-05", {"2025": 1.0, "2026": 2.5})) == {}
    assert sorted(p.name for p in obs_dir.iterdir()) == ["TOY-2026-09-17.csv", "TOY-2026-11-05.csv"]


def test_numbers_going_back_to_an_older_edition_are_written(obs_dir):
    """Only the newest edition holding the rows counts: A, B, then A's numbers again is a real change."""
    from etl.build import Store, read_committed, write_observations

    write_observations("toy", _edition("TOY-2026-01", {"2025": 1.0}))
    write_observations("toy", _edition("TOY-2026-02", {"2025": 1.1}))
    assert write_observations("toy", _edition("TOY-2026-03", {"2025": 1.0})) == {}
    assert Store({"toy": read_committed("toy")}).get("macro.toy", "2025", ["toy"]).vintage == "TOY-2026-03"


def test_a_revision_under_the_same_label_is_rewritten_in_place(obs_dir):
    from etl.build import read_committed, write_observations

    write_observations("toy", _edition("TOY-2026-09", {"2025": 1.0}))
    assert write_observations("toy", _edition("TOY-2026-09", {"2025": 1.2})) == {}
    assert [(o.vintage, o.value) for o in read_committed("toy")] == [("TOY-2026-09", 1.2)]


def test_several_files_per_source_are_matched_one_by_one(obs_dir):
    """GOV.UK-style: one file per page; a republished page with the same rates keeps its file, a changed page gets one."""
    from etl.build import write_observations

    pages = lambda fuel_date, it_date, it_rate: [
        *[o.model_copy(update={"series_id": "tax.fuel"}) for o in _edition(f"fuel@{fuel_date}", {"2026-27": 52.95})],
        *_edition(f"income-tax@{it_date}", {"2026-27": it_rate}),
    ]
    write_observations("toy", pages("2026-09-30", "2026-10-01", 20.0))
    assert write_observations("toy", pages("2026-11-12", "2026-11-12", 21.0)) == {"fuel@2026-11-12": "fuel@2026-09-30"}
    assert sorted(p.name for p in obs_dir.iterdir()) == ["fuel@2026-09-30.csv", "income-tax@2026-10-01.csv", "income-tax@2026-11-12.csv"]


def test_online_build_assembles_what_the_offline_rebuild_will(obs_dir, monkeypatch):
    """The nightly build reads back the committed editions, so CI's offline rebuild reproduces its output exactly."""
    import types

    import etl.build as build
    from etl.core import Source

    src = Source(id="toy", title="Toy", publisher="Nobody", url="https://example.org/", cadence_days=49)
    # An older edition holds a point the new one no longer carries (Bank Rate: the previous hold).
    build.write_observations("toy", _edition("TOY as of 2026-09-17", {"2025-12-18": 3.75, "2026-09-17": 3.75}))
    new = _edition("TOY as of 2026-11-05", {"2025-12-18": 3.75, "2026-11-05": 3.5})
    monkeypatch.setattr(build, "discover", lambda: [types.SimpleNamespace(SOURCE=src, fetch=lambda since: [], parse=lambda raws: new)])

    online = build.collect(Run(build_id="test", started_at="test", trigger="test"), offline=False)
    offline = build.collect(Run(build_id="test", started_at="test", trigger="test"), offline=True)
    assert online == offline
    assert {o.period for o in online["toy"]} == {"2025-12-18", "2026-09-17", "2026-11-05"}

    # The next night brings the same numbers under a later label: nothing is written, an info check says why.
    relabelled = [o.model_copy(update={"vintage": "TOY as of 2026-11-06"}) for o in new]
    monkeypatch.setattr(build, "discover", lambda: [types.SimpleNamespace(SOURCE=src, fetch=lambda since: [], parse=lambda raws: relabelled)])
    run = Run(build_id="test", started_at="test", trigger="test")
    assert build.collect(run, offline=False) == offline
    assert [(c.check_id, c.level) for c in run.checks] == [("edition", "info")]
    assert "kept TOY as of 2026-11-05" in run.checks[0].message


def test_offline_takes_the_edition_from_the_manifest_and_the_cadence_from_the_module():
    from etl.build import recorded_source
    from etl.core import Source

    declared = Source(id="toy", title="Toy", publisher="Nobody", url="https://example.org/", cadence_days=49, grace_days=14)
    recorded = {"toy": {**declared.model_dump(mode="json"), "title": "Toy, 2026 edition", "published_on": "2026-09-17", "cadence_days": 45}}
    src = recorded_source(declared, recorded)
    assert (src.title, str(src.published_on), src.cadence_days, src.grace_days) == ("Toy, 2026 edition", "2026-09-17", 49, 14)
