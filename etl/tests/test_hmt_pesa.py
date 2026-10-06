"""
Tests for etl/sources/hmt_pesa.py against the real PESA files.

Online (default): fetch() finds the latest edition through the GOV.UK content
API and downloads it (cached for 20 h by core.download). With --offline the
tests use whatever is already in data/raw/hmt_pesa/ and skip if it is empty.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict

import pytest

from etl.core import RAW_DIR, SERIES, RawArtifact, download
from etl.sources import hmt_pesa

FUNCTIONS = [f"spending.cofog.{f}" for f in hmt_pesa.FUNCTIONS.values()]
EU = "spending.cofog.eu_transactions"
DEBT = "spending.cofog.general_public_services.debt_interest"
TES, ADJ, TME = "spending.tes.total", "spending.accounting_adjustments", "spending.tme"

# Rounding tolerances: the sub-function table is in £ million (11 rounded lines
# -> a few £m), the long function table in £ billion to one decimal place.
TOL_MILLION_TABLE = 0.005  # £bn
TOL_BILLION_TABLE = 0.3  # £bn, 11 lines rounded to 0.1 (largest gap seen in PESA 2026: 0.2)


def _cached() -> list[RawArtifact]:
    folder = RAW_DIR / hmt_pesa.SOURCE.id
    out = []
    for meta_path in sorted(folder.glob("*.xlsx.meta.json")):
        meta = json.loads(meta_path.read_text())
        path = meta_path.with_name(meta_path.name[: -len(".meta.json")])
        if path.exists():
            out.append(RawArtifact(hmt_pesa.SOURCE.id, meta["url"], path, meta["sha256"], meta["fetched_at"], meta.get("content_type"), meta.get("vintage")))
    return out


@pytest.fixture(scope="module")
def raws(request):
    if request.config.getoption("--offline"):
        found = _cached()
        if not found:
            pytest.skip("offline and no cached PESA files")
        return found
    return hmt_pesa.fetch()


@pytest.fixture(scope="module")
def edition(raws):
    return hmt_pesa.choose(hmt_pesa.editions(raws))


@pytest.fixture(scope="module")
def obs(raws):
    return hmt_pesa.parse(raws)


@pytest.fixture(scope="module")
def by(obs):
    d: dict[str, dict[str, float]] = defaultdict(dict)
    for o in obs:
        assert o.period not in d[o.series_id], f"duplicate {o.series_id} {o.period}"
        d[o.series_id][o.period] = o.value
    return d


def _functional_periods(by) -> list[str]:
    return sorted(by[TES])


def _tol(edition, period: str) -> float:
    return TOL_MILLION_TABLE if edition.subfunction and period in edition.subfunction.periods else TOL_BILLION_TABLE


def test_edition_is_recent_and_single_vintage(edition, obs):
    assert edition.vintage.startswith(("PESA-", "PSS-"))
    assert edition.latest_outturn >= "2025-26"
    assert edition.function and edition.subfunction and edition.aggregates
    assert {o.vintage for o in obs} == {edition.vintage}
    assert {o.source_id for o in obs} == {"hmt_pesa"}
    assert {o.unit for o in obs} == {"gbp_bn"}
    assert {o.geography for o in obs} == {"UK"}


def test_core_series_names(obs):
    ids = {o.series_id for o in obs}
    for sid in FUNCTIONS + [DEBT, TES, ADJ, TME]:
        assert sid in SERIES, sid
        assert sid in ids, sid
    assert EU in ids


def test_no_nan(obs):
    assert obs
    for o in obs:
        assert isinstance(o.value, float) and math.isfinite(o.value), (o.series_id, o.period)


def test_every_function_present_each_year(by):
    periods = _functional_periods(by)
    assert periods[0] <= "2020-21" and periods[-1] >= "2025-26"
    for p in periods:
        for sid in FUNCTIONS + [EU, DEBT, ADJ, TME]:
            assert p in by[sid], f"{sid} missing for {p}"


def test_functions_sum_to_tes(by, edition):
    for p in _functional_periods(by):
        total = sum(by[sid][p] for sid in FUNCTIONS) + by[EU][p]
        assert abs(total - by[TES][p]) <= _tol(edition, p), (p, total, by[TES][p])


def test_tes_plus_accounting_adjustments_is_tme(by, edition):
    for p in _functional_periods(by):
        tol = 0.002 if _tol(edition, p) == TOL_MILLION_TABLE else 0.15
        assert abs(by[TES][p] + by[ADJ][p] - by[TME][p]) <= tol, p


def test_subfunctions_sum_to_function(edition):
    t = edition.subfunction
    rows = {r.series_id: r for r in t.rows}
    children = defaultdict(list)
    for r in t.rows:
        if r.parent and not r.memo:
            children[r.parent].append(r)
    for fid in FUNCTIONS + [EU]:
        assert children[fid], f"no sub-functions for {fid}"
    for parent, kids in children.items():
        for p in t.periods:
            total = sum(k.values[p] for k in kids)
            assert abs(total - rows[parent].values[p]) <= TOL_MILLION_TABLE, (parent, p, total, rows[parent].values[p])


def test_social_care_memo_row(edition):
    """Personal social services is a memo row across 10.1-10.7: it equals its pieces and is not counted twice."""
    t = edition.subfunction
    memo = t.get("spending.cofog.social_protection.personal_social_services")
    assert memo is not None and memo.memo
    pieces = [r for r in t.rows if r.level == 3 and r.series_id.startswith("spending.cofog.social_protection.") and r.series_id.endswith(".personal_social_services")]
    assert len(pieces) >= 4
    for p in t.periods:
        assert abs(sum(r.values[p] for r in pieces) - memo.values[p]) <= TOL_MILLION_TABLE


def test_tables_agree_where_they_overlap(edition):
    f, s = edition.function, edition.subfunction
    for p in set(f.periods) & set(s.periods):
        for sid in FUNCTIONS + [EU, DEBT, TES, ADJ, TME]:
            assert abs(f.get(sid).values[p] - s.get(sid).values[p]) <= 0.051, (sid, p)


def test_required_drill_down(by):
    latest = max(_functional_periods(by))
    for sid in [
        "spending.cofog.social_protection.old_age",
        "spending.cofog.social_protection.old_age.pensions",
        "spending.cofog.social_protection.sickness_and_disability",
        "spending.cofog.health.medical_services",
        "spending.cofog.education.secondary_education",
        "spending.cofog.economic_affairs.transport",
        "spending.cofog.general_public_services.debt_interest.central_government",
    ]:
        assert latest in by[sid], sid


def test_kinds(obs, edition):
    latest = edition.latest_outturn
    for o in obs:
        if o.period <= latest:
            assert o.kind == "outturn", (o.series_id, o.period)
        else:
            assert o.kind == "forecast" and o.series_id == TME, (o.series_id, o.period)
    assert any(o.kind == "forecast" for o in obs), "Table 4.1 plan years missing"


def test_latest_year_is_plausible(by):
    """Coarse guard against a column or unit shift (values in £bn for 2025-26)."""
    p = "2025-26"
    assert 1100 < by[TES][p] < 1400
    assert 1250 < by[TME][p] < 1500
    assert 350 < by["spending.cofog.social_protection"][p] < 450
    assert 200 < by["spending.cofog.health"][p] < 300
    assert 80 < by[DEBT][p] < 160
    assert 90 < by[ADJ][p] < 180


def test_pss_function_table_and_edition_choice(raws, request):
    """A Feb/May PSS release (function table only, one year less outturn) parses, and loses to PESA."""
    if request.config.getoption("--offline"):
        cached = [r for r in _cached() if "PSS_May_2026_TES" in r.path.name]
        if not cached:
            pytest.skip("offline and no cached PSS May 2026 file")
        pss = cached[0]
    else:
        pss = download("hmt_pesa", "https://assets.publishing.service.gov.uk/media/6a0d8e255c3c79da61662d88/PSS_May_2026_TES.xlsx", vintage="PSS-2026-05")
    pss.vintage = pss.vintage or "PSS-2026-05"
    eds = hmt_pesa.editions([pss])
    assert len(eds) == 1 and eds[0].function and not eds[0].subfunction
    f = eds[0].function
    assert f.periods[-1] == "2024-25"
    for p in f.periods:
        total = sum(f.get(sid).values[p] for sid in FUNCTIONS) + f.get(EU).values[p]
        assert abs(total - f.get(TES).values[p]) <= TOL_BILLION_TABLE
    best = hmt_pesa.choose(hmt_pesa.editions(list(raws) + [pss]))
    assert best.vintage != "PSS-2026-05"
