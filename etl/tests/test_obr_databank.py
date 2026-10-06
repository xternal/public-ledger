"""
OBR Public finances databank (aggregates) + ONS PSF Appendix D (receipts by tax), parsed from the real files.

Online runs fetch through the modules (cached 20 h). With --offline the tests reuse files already in
data/raw/ and skip if there are none.

Tolerances (£bn):
  * PSCR + PSNB vs TME, databank: 0.5 (PSNB is published as TME - PSCR, so the gap should be 0).
  * Databank receipts columns vs PSCR: 0.01 (the "Other" column is OBR's residual).
  * 13 Statement lines vs ONS PSCR (JW2O, emitted as receipts.total by ons_psf_receipts): 0.01.
  * Appendix D JW2O vs JW2O in the PUSF dataset (ons_psf): 0.01 for the same release.
  * 13 Statement lines vs databank PSCR: 0.01 when the ONS table and the databank reflect the same PSF
    release (normal case), else 5.0 (ONS published a newer PSF and OBR has not refreshed yet).
  * other_taxes / non_tax vs the explicit sum of the remaining ONS rows: 0.01.
  * PSND % GDP vs PSND / centred GDP: 1.0 percentage point (the published ratio uses a newer GDP
    estimate than the databank's centred-GDP column for the latest year).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict

import pytest

from etl.core import RAW_DIR, Observation, RawArtifact
from etl.sources import obr_databank, ons_psf_receipts

STATEMENT_LINES = [
    "receipts.income_tax", "receipts.nics", "receipts.vat", "receipts.corp_tax", "receipts.council_tax",
    "receipts.business_rates", "receipts.fuel_duty", "receipts.stamp_duty", "receipts.cgt",
    "receipts.alcohol_tobacco", "receipts.iht", "receipts.other_taxes", "receipts.non_tax",
]
TOL_IDENTITY = 0.5
TOL_SAME_RELEASE = 0.01
TOL_OTHER_RELEASE = 5.0


def _cached(source_id: str, filename: str) -> list[RawArtifact]:
    path = RAW_DIR / source_id / filename
    meta_path = RAW_DIR / source_id / f"{filename}.meta.json"
    if not (path.exists() and meta_path.exists()):
        pytest.skip(f"--offline and no cached {source_id}/{filename}")
    m = json.loads(meta_path.read_text())
    return [RawArtifact(source_id, m["url"], path, m["sha256"], m["fetched_at"], m.get("content_type"), m.get("vintage"))]


def _cached_optional(source_id: str, filename: str) -> list[RawArtifact]:
    path = RAW_DIR / source_id / filename
    meta_path = RAW_DIR / source_id / f"{filename}.meta.json"
    if not (path.exists() and meta_path.exists()):
        return []
    m = json.loads(meta_path.read_text())
    return [RawArtifact(source_id, m["url"], path, m["sha256"], m["fetched_at"], m.get("content_type"), m.get("vintage"))]


@pytest.fixture(scope="module")
def db_raws(request) -> list[RawArtifact]:
    if request.config.getoption("--offline"):
        return _cached(obr_databank.SOURCE.id, obr_databank.XLSX_NAME)
    return obr_databank.fetch(None)


@pytest.fixture(scope="module")
def ons_raws(request) -> list[RawArtifact]:
    if request.config.getoption("--offline"):
        return _cached(ons_psf_receipts.SOURCE.id, ons_psf_receipts.XLSX_NAME)
    return ons_psf_receipts.fetch(None)


def _index(obs: list[Observation]) -> dict[str, dict[str, Observation]]:
    d: dict[str, dict[str, Observation]] = defaultdict(dict)
    for o in obs:
        assert o.period not in d[o.series_id], f"duplicate {o.series_id} {o.period}"
        d[o.series_id][o.period] = o
    return d


@pytest.fixture(scope="module")
def db_obs(db_raws) -> list[Observation]:
    return obr_databank.parse(db_raws)


@pytest.fixture(scope="module")
def db(db_obs):
    return _index(db_obs)


@pytest.fixture(scope="module")
def ons_obs(ons_raws) -> list[Observation]:
    return ons_psf_receipts.parse(ons_raws)


@pytest.fixture(scope="module")
def ons(ons_obs):
    return _index(ons_obs)


@pytest.fixture(scope="module")
def outturn_years(db_obs) -> list[str]:
    latest = obr_databank.latest_outturn_year(db_obs)
    years = [f"{y}-{(y + 1) % 100:02d}" for y in range(2019, int(latest[:4]) + 1)]
    assert years[0] == obr_databank.FIRST_FY
    return years


@pytest.fixture(scope="module")
def same_release(db_raws, ons_raws) -> bool:
    return obr_databank.read_edition(db_raws[0].path).psf_release == ons_psf_receipts.read_edition(ons_raws[0].path).published_on


# --------------------------------------------------------------------------- databank


def test_find_databank_link_on_cached_page():
    page = RAW_DIR / obr_databank.SOURCE.id / obr_databank.PAGE_NAME
    if not page.exists():
        pytest.skip("OBR data page not cached")
    url, vintage = obr_databank.find_databank_link(page.read_text(errors="replace"))
    assert "/download/public-finances-databank-" in url
    assert vintage.startswith("OBR-PFD-20") and len(vintage) == len("OBR-PFD-2026-09")


def test_labels_and_slugs():
    assert obr_databank.label("Public sector net debt2") == "public sector net debt"
    assert obr_databank.label("GDP Deflator (2025-26=100)") == "gdp deflator (2025-26=100)"
    assert obr_databank.slug("Onshore corporation tax (includes Bank Surcharge and EGL)3") == "onshore_corporation_tax"
    assert ons_psf_receipts.slug("Other taxes on production - of which air passenger duty  (£ millions)") == "other_taxes_on_production_air_passenger_duty"


def test_metadata(db_obs, db_raws):
    assert {o.source_id for o in db_obs} == {"obr_databank"}
    assert len({o.vintage for o in db_obs}) == 1
    assert db_obs[0].vintage.startswith("OBR-PFD-20")
    assert obr_databank.SOURCE.cadence_days == 31 and obr_databank.SOURCE.grace_days == 21
    ed = obr_databank.read_edition(db_raws[0].path)
    assert ed.psf_release is not None and ed.forecast_from


def test_required_series_cover_history(db, outturn_years):
    units = {"fiscal.psnd_pct_gdp": "pct_gdp"}
    for sid in obr_databank.REQUIRED:
        for fy in outturn_years:
            o = db[sid].get(fy)
            assert o is not None, f"{sid} missing {fy}"
            assert o.kind == "outturn" and o.quality == "sourced"
            assert o.unit == units.get(sid, "gbp_bn")
        forecast = [p for p, o in db[sid].items() if o.kind == "forecast"]
        assert all(p > outturn_years[-1] for p in forecast), sid


def test_no_nan_no_duplicates(db_obs):
    for o in db_obs:
        assert math.isfinite(o.value), f"{o.series_id} {o.period}"


def test_pscr_plus_psnb_equals_tme(db):
    gaps = {}
    for fy, tme in sorted(db["spending.tme"].items()):
        gaps[fy] = round(tme.value - db["receipts.total"][fy].value - db["fiscal.psnb"][fy].value, 3)
    print("\nTME - (PSCR + PSNB), £bn:", gaps)
    assert all(abs(g) <= TOL_IDENTITY for g in gaps.values()), gaps


def test_sanity_anchors(db):
    psnb_2020 = db["fiscal.psnb"]["2020-21"].value
    print(f"\nPSNB 2020-21 = £{psnb_2020:.1f}bn; PSND end-March 2021 = £{db['fiscal.psnd']['2020-21'].value:.1f}bn")
    assert 250 < psnb_2020 < 350  # pandemic year, roughly £300bn
    assert psnb_2020 == max(o.value for o in db["fiscal.psnb"].values())
    assert db["macro.nominal_gdp"]["2020-21"].value < db["macro.nominal_gdp"]["2019-20"].value
    assert 90 < db["fiscal.psnd_pct_gdp"]["2020-21"].value < 100
    assert db["spending.tme"]["2020-21"].value > 1000
    assert 20 < db["spending.debt_interest"]["2020-21"].value < db["spending.debt_interest"]["2022-23"].value


def test_psnd_ratio_close_to_level_over_centred_gdp(db, outturn_years):
    gaps = {}
    for fy in outturn_years:
        derived = 100 * db["fiscal.psnd"][fy].value / db["macro.nominal_gdp_centred"][fy].value
        gaps[fy] = round(db["fiscal.psnd_pct_gdp"][fy].value - derived, 2)
    print("\nPSND % GDP published minus PSND / centred GDP, pp:", gaps)
    assert all(abs(g) <= 1.0 for g in gaps.values()), gaps


def test_databank_receipts_columns_sum_to_pscr(db):
    prefix = obr_databank.DETAIL_PREFIX
    totals = {prefix + "public_sector_current_receipts", prefix + "national_accounts_taxes"}
    cols = [s for s in db if s.startswith(prefix) and s not in totals]
    assert len(cols) >= 25
    for fy, total in db["receipts.total"].items():
        s = sum(db[c][fy].value for c in cols)
        assert abs(s - total.value) <= TOL_SAME_RELEASE, (fy, s, total.value)


# --------------------------------------------------------------------------- receipts by tax (ONS Appendix D)


def test_ons_metadata(ons_obs):
    assert ons_psf_receipts.SOURCE.cadence_days == 31
    assert {o.source_id for o in ons_obs} == {"ons_psf_receipts"}
    assert {o.kind for o in ons_obs} == {"outturn"}
    assert {o.quality for o in ons_obs} == {"sourced"}
    assert all(o.method_note for o in ons_obs)
    assert len({o.vintage for o in ons_obs}) == 1 and ons_obs[0].vintage.startswith("PSF-20")


def test_statement_lines_cover_history(ons, outturn_years):
    for sid in STATEMENT_LINES + ["receipts.total"]:
        for fy in outturn_years:
            o = ons[sid].get(fy)
            assert o is not None, f"{sid} missing {fy}"
            assert math.isfinite(o.value) and o.unit == "gbp_bn"


def test_statement_lines_sum_to_own_total(ons, outturn_years):
    gaps = {fy: round(sum(ons[s][fy].value for s in STATEMENT_LINES) - ons["receipts.total"][fy].value, 6) for fy in outturn_years}
    print("\n13 lines minus ONS PSCR (JW2O), £bn:", gaps)
    assert all(abs(g) <= TOL_SAME_RELEASE for g in gaps.values()), gaps


def test_statement_lines_sum_to_databank_total(ons, db, outturn_years, same_release):
    tol = TOL_SAME_RELEASE if same_release else TOL_OTHER_RELEASE
    gaps = {fy: round(sum(ons[s][fy].value for s in STATEMENT_LINES) - db["receipts.total"][fy].value, 3) for fy in outturn_years}
    print(f"\n13 lines minus databank PSCR, £bn (same PSF release: {same_release}, tolerance {tol}):", gaps)
    assert all(abs(g) <= tol for g in gaps.values()), gaps


def test_ons_total_matches_pusf_jw2o(ons, outturn_years):
    """Appendix D's JW2O against the same CDID in the PUSF dataset that ons_psf ingests (cached file only)."""
    from etl.sources import ons_psf

    raws = _cached_optional(ons_psf.SOURCE.id, "pusf.csv")
    if not raws:
        pytest.skip("PUSF CSV not cached by ons_psf")
    pusf = {o.period: o for o in ons_psf.parse(raws) if o.series_id == "receipts.total"}
    common = [fy for fy in outturn_years if fy in pusf]
    assert common
    same = pusf[common[0]].vintage == ons["receipts.total"][common[0]].vintage
    gaps = {fy: round(ons["receipts.total"][fy].value - pusf[fy].value, 3) for fy in common}
    print(f"\nAppendix D JW2O minus PUSF JW2O, £bn (same vintage: {same}):", gaps)
    assert all(abs(g) <= (TOL_SAME_RELEASE if same else TOL_OTHER_RELEASE) for g in gaps.values()), gaps


def test_residual_lines_equal_explicit_rows(ons_raws, ons, outturn_years):
    cols = ons_psf_receipts.read_columns(ons_psf_receipts._workbook(ons_raws[0].path))
    for fy in outturn_years:
        other = ons_psf_receipts.combine(cols, ons_psf_receipts.OTHER_TAX_ROWS, fy)
        non_tax = ons_psf_receipts.combine(cols, ons_psf_receipts.NON_TAX_ROWS, fy)
        assert abs(ons["receipts.other_taxes"][fy].value - other) <= TOL_SAME_RELEASE, (fy, other)
        assert abs(ons["receipts.non_tax"][fy].value - non_tax) <= TOL_SAME_RELEASE, (fy, non_tax)


def test_ons_lines_match_databank_columns(ons, db, outturn_years, same_release):
    if not same_release:
        pytest.skip("ONS Appendix D and the databank reflect different PSF releases")
    p = obr_databank.DETAIL_PREFIX
    same = {
        "receipts.income_tax": ["pay_as_your_earn_income_tax", "self_assessed_income_tax", "other_income_tax"],
        "receipts.nics": ["national_insurance_contributions"],
        "receipts.vat": ["vat"],
        "receipts.council_tax": ["council_tax"],
        "receipts.fuel_duty": ["fuel_duties"],
        "receipts.stamp_duty": ["stamp_duty_land_tax", "stamp_taxes_on_shares"],
        "receipts.cgt": ["capital_gains_tax"],
        "receipts.alcohol_tobacco": ["alcohol_duties", "tobacco_duties"],
        "receipts.iht": ["inheritance_tax"],
        # ONS onshore CT includes the diverted profits tax; the databank shows it separately.
        "receipts.corp_tax": ["onshore_corporation_tax", "offshore_corporation_tax", "diverted_profits_tax"],
    }
    for sid, cols in same.items():
        for fy in outturn_years:
            want = sum(db[p + c][fy].value for c in cols)
            assert abs(ons[sid][fy].value - want) <= TOL_SAME_RELEASE, (sid, fy, ons[sid][fy].value, want)


def test_business_rates_plausible(ons, outturn_years):
    br = {fy: ons["receipts.business_rates"][fy].value for fy in outturn_years}
    print("\nBusiness rates (ONS CUKY), £bn:", {k: round(v, 2) for k, v in br.items()})
    assert all(10 < v < 45 for v in br.values())
    assert min(br, key=br.get) == "2020-21"  # pandemic retail, hospitality and leisure relief
