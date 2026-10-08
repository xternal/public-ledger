"""
Forecasts against outturn (M7, etl/backtest.py): scoring rules, what gets
recorded, append-only records, and that the committed files are what the job
produces from the committed build.
"""

import csv
import json
import shutil
from datetime import date
from pathlib import Path

import pytest

from etl import backtest
from etl.backtest import file_name, find_outturn, outturn_store, record, score, score_one
from etl.core import BUILD_DIR

SOURCES = ["obr_efo", "obr_databank", "ons_psf", "ons_npp", "ons_mye_components", "hmt_pesa"]
TODAY = date(2026, 10, 8)


@pytest.fixture
def build(tmp_path: Path) -> Path:
    """A copy of the committed build, without forecast records, to record into."""
    out = tmp_path / "build"
    out.mkdir()
    for name in ("manifest.json", "people.json"):
        shutil.copy(BUILD_DIR / name, out / name)
    shutil.copytree(BUILD_DIR / "statements", out / "statements")
    for sid in SOURCES:
        shutil.copytree(BUILD_DIR / "observations" / sid, out / "observations" / sid)
    return out


def records(build: Path) -> dict[str, dict]:
    return {r["id"]: r for r in backtest.load_records(build)}


# ------------------------------------------------------------------ scoring


def test_a_range_hits_when_the_outturn_is_inside_it():
    assert score_one([90, 100, 110], 104)["result"] == "hit"
    assert score_one([90, 100, 110], 110)["result"] == "hit"  # the edges count
    assert score_one([90, 100, 110], 104)["miss"] == 0


def test_a_miss_is_measured_from_the_nearer_edge():
    above = score_one([90, 100, 110], 115)
    assert above == {"result": "miss_above", "miss": 5, "miss_pct": 5.0, "error": 15, "error_pct": 15.0}
    below = score_one([90, 100, 110], 80)
    assert (below["result"], below["miss"], below["error"]) == ("miss_below", 10, -20)


def test_a_single_number_misses_by_its_error():
    s = score_one([132.735, 132.735, 132.735], 134.286)
    assert (s["result"], s["miss"], s["error"]) == ("miss_above", 1.551, 1.551)
    assert score_one([5, 5, 5], 5.0004)["result"] == "hit"  # equal at the stored precision


def test_file_names_are_safe():
    assert file_name("EFO-2026-03+PESA-2026") == "EFO-2026-03_PESA-2026"
    assert file_name("NPP-2024based-2026-04-28") == "NPP-2024based-2026-04-28"


# ------------------------------------------------------------------ recording


def test_records_what_the_site_shows_and_earlier_official_forecasts_as_context(build):
    added, warnings = record(TODAY, build)
    got = records(build)
    assert added == len(got) and warnings == []
    by = lambda maker, as_: [r for r in got.values() if r["maker"] == maker and r["recorded_as"] == as_]  # noqa: E731

    # OBR: six aggregates for each forecast year the Statement shows, single numbers, dated by the EFO.
    obr = by("obr", "shown")
    assert {r["series_id"] for r in obr} == set(backtest.OBR_SERIES)
    assert sorted({r["period"] for r in obr}) == ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"]
    assert all(r["range"] == "point" and r["made_on"] == "2026-03-03" and r["quality"] == "sourced" for r in obr)
    psnb = got["obr:EFO-2026-03:fiscal.psnb:2026-27"]
    assert psnb["predicted"] == [115.461, 115.461, 115.461]
    # The year the site now shows as outturn is kept as context, labelled as the OBR's.
    assert {(r["series_id"], r["period"]) for r in by("obr", "context")} == {(s, "2025-26") for s in backtest.OBR_SERIES}

    # Ours: nine function lines a year, approx, made on the day recorded.
    own = by("public_ledger", "shown")
    assert len(own) == 9 * 5 and all(r["quality"] == "approx" and r["made_on"] == TODAY.isoformat() for r in own)
    assert all(r["vintage"] == "EFO-2026-03+PESA-2026" for r in own)

    # ONS: the range /people shows, from the lowest to the highest variant.
    births = got["ons:NPP-2024based-2026-04-28:people.births:2026"]
    assert births["range"] == "range" and births["predicted"][0] < births["predicted"][1] < births["predicted"][2]
    assert {r["period"] for r in by("ons", "context")} == {"2025"}

    # Nothing from promise cards or scenarios.
    assert not any(r["series_id"].startswith(("promise", "scenario")) for r in got.values())


def test_records_are_append_only(build):
    record(TODAY, build)
    path = build / "forecasts" / "obr" / "EFO-2026-03.json"
    data = json.loads(path.read_text())
    data["forecasts"][0]["predicted"] = [1.0, 1.0, 1.0]
    path.write_text(json.dumps(data))
    added, warnings = record(date(2026, 10, 9), build)
    assert added == 0
    assert len(warnings) == 1 and "kept as recorded" in warnings[0]
    assert json.loads(path.read_text())["forecasts"][0]["predicted"] == [1.0, 1.0, 1.0]  # never rewritten


def test_a_new_edition_adds_a_new_file_and_leaves_the_old_one(build):
    record(TODAY, build)
    old = (build / "forecasts" / "obr" / "EFO-2026-03.json").read_text()
    # A November EFO: the same rows under a new label. The Statement still shows March's, so its forecasts are context.
    src = build / "observations" / "obr_efo" / "EFO-2026-03.csv"
    rows = list(csv.DictReader(src.open()))
    with (build / "observations" / "obr_efo" / "EFO-2026-11.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=rows[0].keys(), lineterminator="\n")
        w.writeheader()
        w.writerows({**r, "vintage": "EFO-2026-11"} for r in rows)
    added, _ = record(date(2026, 11, 27), build)
    assert added == 36
    assert (build / "forecasts" / "obr" / "EFO-2026-03.json").read_text() == old
    new = json.loads((build / "forecasts" / "obr" / "EFO-2026-11.json").read_text())
    assert new["made_on"] == "2026-11-01" and {r["recorded_as"] for r in new["forecasts"]} == {"context"}


# ------------------------------------------------------------------ outturn


def test_outturn_prefers_ons_and_ignores_forecast_rows(build):
    store = outturn_store(build / "observations")
    psnb = find_outturn(store, "fiscal.psnb", "2025-26")
    assert (psnb.source_id, psnb.vintage) == ("ons_psf", "PSF-2026-09")
    assert find_outturn(store, "fiscal.psnb", "2026-27") is None  # only forecasts so far
    health = find_outturn(store, "statement.spending.health", "2025-26")
    assert health.source_id == "hmt_pesa" and health.value == pytest.approx(257.542, abs=1e-3)
    assert find_outturn(store, "people.births", "2025").source_id == "ons_mye_components"


def test_scores_what_has_outturn(build):
    record(TODAY, build)
    table = score(build)
    ids = [r["forecast_id"] for r in table["results"]]
    assert len(ids) == 8 and all(":2025-26" in i or i.endswith(":2025") for i in ids)
    assert {e["source_id"] for e in table["outturn_editions"]} == {"ons_psf", "ons_mye_components"}


def test_committed_files_are_what_the_job_produces():
    """CI runs the job and diffs: a forgotten run, or a hand edit, fails here first."""
    committed = json.loads((BUILD_DIR / "backtest.json").read_text())
    assert score(BUILD_DIR) == committed
    for path in (BUILD_DIR / "forecasts").glob("*/*.json"):
        data = json.loads(path.read_text())
        assert path.name == f"{file_name(data['vintage'])}.json"
        assert [r["id"] for r in data["forecasts"]] == list(dict.fromkeys(r["id"] for r in data["forecasts"]))
