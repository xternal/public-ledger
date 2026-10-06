"""
Tests for etl/sources/obr_efo.py against the real workbooks of the latest OBR EFO
(March 2026 as of October 2026), plus network-free tests of edition discovery.

Run: cd etl && .venv/bin/python -m pytest tests/test_obr_efo.py -q
With --offline the tests use files already in data/raw/obr_efo/ and skip if there are none.
"""

import json
import math
import re
import shutil
from collections import defaultdict
from datetime import date

import httpx
import openpyxl
import pytest

from etl.core import ROOT, SERIES, RawArtifact, fiscal_year, normalise_fiscal_year
from etl.sources import obr_efo

SEED = json.loads((ROOT / "data/seed/uk_fy2025-26_pnl.json").read_text())
STATEMENT = [f"receipts.{line}" for line in obr_efo.STATEMENT_LINES]
REQUIRED = [
    "receipts.total",
    *STATEMENT,
    "spending.tme",
    "spending.debt_interest",
    "fiscal.psnb",
    "fiscal.psnd",
    "fiscal.psnd_pct_gdp",
    "macro.nominal_gdp",
]

# The 13 Statement lines are sums of published rows; only float rounding separates them from PSCR.
STATEMENT_SUM_TOL_BN = 0.001
# OBR defines PSNB = TME - PSCR, so the published tables should agree to rounding.
IDENTITY_TOL_BN = 0.05


@pytest.fixture(scope="module")
def raws(request):
    if request.config.getoption("--offline"):
        found = obr_efo.cached_artifacts()
        if found is None:
            pytest.skip("offline and no cached OBR files in data/raw/obr_efo/")
        return found
    return obr_efo.fetch()


@pytest.fixture(scope="module")
def obs(raws):
    return obr_efo.parse(raws)


@pytest.fixture(scope="module")
def table(obs):
    t = defaultdict(dict)
    for o in obs:
        t[o.series_id][o.period] = o
    return t


@pytest.fixture(scope="module")
def vintage(obs):
    return obs[0].vintage


@pytest.fixture(scope="module")
def years(table):
    """The fiscal years the edition covers, taken from receipts.total."""
    return sorted(table["receipts.total"])


def v(table, sid, period):
    return table[sid][period].value


def test_years_contiguous_through_2030_31(years):
    starts = [int(y[:4]) for y in years]
    assert starts == list(range(starts[0], starts[0] + len(starts))), years
    assert len(years) >= 6 and years[-1] >= "2030-31", years
    assert all(normalise_fiscal_year(y) == y for y in years)


def test_required_series_cover_every_year(table, years):
    for sid in REQUIRED:
        assert sid in SERIES, f"{sid} is not a SERIES name in etl/core.py"
        assert sid in table, f"missing series {sid}"
        assert sorted(table[sid]) == years, f"{sid} years {sorted(table[sid])} != {years}"


def test_values_finite_and_metadata(obs, vintage):
    assert re.fullmatch(r"EFO-\d{4}-\d{2}", vintage)
    if obr_efo.EDITION is not None:  # set when fetch() ran
        assert vintage == obr_efo.EDITION.vintage
        assert obr_efo.SOURCE.url == obr_efo.EDITION.url
        assert obr_efo.SOURCE.published_on == obr_efo.EDITION.published_on is not None
    assert (obr_efo.SOURCE.cadence_days, obr_efo.SOURCE.grace_days) == (245, 30)
    assert len(obs) > 300
    for o in obs:
        assert math.isfinite(o.value), (o.series_id, o.period)
        assert o.geography == "UK"
        assert o.vintage == vintage
        assert o.source_id == obr_efo.SOURCE.id
        assert o.quality == "sourced"
        assert o.unit in ("gbp_bn", "pct_gdp")


def test_kind_outturn_then_forecast(table, years):
    for sid in REQUIRED:
        kinds = [table[sid][y].kind for y in years]
        assert kinds[0] == "outturn" and kinds[-1] == "forecast", (sid, kinds)
        assert kinds == sorted(kinds, key=lambda k: k == "forecast"), (sid, kinds)  # no outturn after forecast


def test_units(table, years):
    for y in years:
        assert table["fiscal.psnd_pct_gdp"][y].unit == "pct_gdp"
        for sid in REQUIRED:
            if sid != "fiscal.psnd_pct_gdp":
                assert table[sid][y].unit == "gbp_bn", sid


def test_statement_lines_sum_to_receipts_total(table, years):
    for y in years:
        s = sum(v(table, sid, y) for sid in STATEMENT)
        assert abs(s - v(table, "receipts.total", y)) <= STATEMENT_SUM_TOL_BN, (y, s)


def test_summed_lines_say_what_was_summed(table, years):
    for sid in ("receipts.stamp_duty", "receipts.alcohol_tobacco", "receipts.other_taxes", "receipts.non_tax"):
        assert table[sid][years[0]].method_note.startswith("Sum of"), sid


def test_detail_rows_rebuild_the_total(table, years):
    """Top-level receipts.detail rows (no 'of which', subtotal or memo note) are the OBR tax and non-tax rows."""
    additive = [sid for sid in table if sid.startswith("receipts.detail.") and not table[sid][years[0]].method_note]
    assert len(additive) >= 30
    for y in years:
        s = sum(v(table, sid, y) for sid in additive)
        assert abs(s - v(table, "receipts.total", y)) <= STATEMENT_SUM_TOL_BN, (y, s)


def test_no_negative_statement_lines(table, years):
    for sid in STATEMENT + ["receipts.total", "spending.tme", "spending.debt_interest", "fiscal.psnd", "macro.nominal_gdp"]:
        for y in years:
            assert v(table, sid, y) > 0, (sid, y)


def test_pscr_plus_psnb_close_to_tme(table, years):
    for y in years:
        gap = v(table, "receipts.total", y) + v(table, "fiscal.psnb", y) - v(table, "spending.tme", y)
        assert abs(gap) <= IDENTITY_TOL_BN, (y, gap)


def test_psnd_ratio_uses_centred_gdp(table, years):
    for y in years:
        ratio = 100 * v(table, "fiscal.psnd", y) / v(table, "macro.nominal_gdp_centred_end_march", y)
        assert abs(ratio - v(table, "fiscal.psnd_pct_gdp", y)) < 0.01, y


def test_debt_interest_ready_reckoner(table, years):
    for which in ("gilt_rates", "short_rates"):
        sid = f"reckoner.debt_interest.{which}_1pp"
        assert sid in table, sid
        rr_years = sorted(table[sid])
        assert len(rr_years) >= 4 and set(rr_years) <= set(years), rr_years
        for y in rr_years:
            o = table[sid][y]
            assert o.unit == "gbp_bn" and o.kind == "forecast"
            assert 0 < o.value < 50, (sid, y, o.value)


def test_against_seed_claims(table, vintage):
    """
    The seed (data/seed/uk_fy2025-26_pnl.json) quotes OBR March 2026 headline numbers for 2025-26.
    Real values must agree to the seed's own rounding; the parser is not tuned to the seed.
    Only meaningful while the latest EFO is the seed's edition.
    """
    if vintage != SEED["meta"]["vintage"]:
        pytest.skip(f"latest EFO is {vintage}; seed quotes {SEED['meta']['vintage']}")
    claims = {  # series -> (seed value, half the seed's rounding step)
        "receipts.total": (1235, 0.5),
        "spending.tme": (1368, 0.5),
        "fiscal.psnb": (132.7, 0.05),
        "spending.debt_interest": (110, 0.5),
        "fiscal.psnd_pct_gdp": (94.3, 0.05),
    }
    for sid, (seed, tol) in claims.items():
        assert abs(v(table, sid, "2025-26") - seed) <= tol, (sid, v(table, sid, "2025-26"), seed)

    seed = SEED["macro"]
    for y, val in seed["baseline_psnb_bn"].items():
        assert abs(v(table, "fiscal.psnb", y) - val) <= 0.05, ("psnb", y)
    for y, val in seed["baseline_psnd_pct_gdp"].items():
        assert abs(v(table, "fiscal.psnd_pct_gdp", y) - val) <= 0.05, ("psnd_pct_gdp", y)


def test_clean_label_and_slug():
    assert obr_efo.clean_label("Income tax1") == "Income tax"
    assert obr_efo.clean_label("Nominal GDP (£ billion)1,2") == "Nominal GDP (£ billion)"
    assert obr_efo.clean_label("Central government debt interest,  ") == "Central government debt interest,"
    assert obr_efo.clean_label("Pillar 2") == "Pillar 2"
    assert obr_efo.slug("Memo: UK oil and gas revenues6") == "memo_uk_oil_and_gas_revenues"


# --------------------------------------------------------------------------- loud failures (real files)


def _with_edit(raws, tmp_path, edit):
    """Copy the annex workbook (values only), apply `edit` to it, and return raws pointing at the copy."""
    annex = obr_efo._pick(raws, "annex")
    wb = openpyxl.load_workbook(annex.path, data_only=True)
    edit(wb)
    copy = tmp_path / annex.path.name
    wb.save(copy)
    rr = obr_efo._pick(raws, "debt_interest_rr")
    return [RawArtifact(annex.source_id, annex.url, copy, "x", annex.fetched_at, None, annex.vintage), rr]


def test_missing_sheet_fails_loudly(raws, tmp_path):
    def drop(wb):
        del wb["TA.5"]
    with pytest.raises(ValueError, match="TA.5"):
        obr_efo.parse(_with_edit(raws, tmp_path, drop))


def test_renamed_receipts_row_fails_loudly(raws, tmp_path):
    def rename(wb):
        for row in wb["TA.5"].iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.strip() == "Value added tax":
                    c.value = "VAT (new name)"
    with pytest.raises(ValueError, match="value added tax"):
        obr_efo.parse(_with_edit(raws, tmp_path, rename))


def test_mixed_editions_rejected(raws, tmp_path):
    annex, rr = obr_efo._pick(raws, "annex"), obr_efo._pick(raws, "debt_interest_rr")
    other = tmp_path / "efo_2099_11_annex_tables.xlsx"
    shutil.copy(annex.path, other)
    with pytest.raises(ValueError, match="different editions"):
        obr_efo.parse([RawArtifact(annex.source_id, annex.url, other, "x", annex.fetched_at), rr])


# --------------------------------------------------------------------------- discovery (no network)


def _page(canonical, links=(), title=None, published=None):
    head = f'<link rel="canonical" href="{canonical}" />'
    if title:
        head += f'<meta property="og:title" content="{title} - Office for Budget Responsibility" />'
    if published:
        head += f'<script type="application/ld+json">{{"datePublished":"{published}T09:00:00+00:00"}}</script>'
    body = "".join(f'<a href="{u}">x</a>' for u in links)
    return f"<html><head>{head}</head><body>{body}</body></html>"


def _workbook_links(tag):
    return [
        f"https://obr.uk/download/{tag}-economic-and-fiscal-outlook-charts-and-tables-annex-tables/?tmstv=1",
        f"https://obr.uk/download/{tag}-economic-and-fiscal-outlook-detailed-forecast-tables-debt-interest-ready-reckoner/?tmstv=1",
        f"https://obr.uk/download/{tag}-devolved-tax-and-spending-forecasts-charts-and-tables/?tmstv=1",
    ]


MAR26 = "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/"
NOV25 = "https://obr.uk/efo/economic-and-fiscal-outlook-november-2025/"
NOV26 = "https://obr.uk/efo/economic-and-fiscal-outlook-november-2026/"


@pytest.fixture
def fake_site(monkeypatch, tmp_path):
    """Serve pages from a dict instead of OBR; a missing URL raises like a network error."""
    pages = {}
    requested = []

    def fake_download(source_id, url, filename=None, **kw):
        requested.append(url)
        if url not in pages:
            raise httpx.ConnectError(f"no route to {url}")
        path = tmp_path / (filename or "page.html")
        path.write_text(pages[url])
        return RawArtifact(source_id, url, path, "x", "2026-10-06T00:00:00+00:00")

    monkeypatch.setattr(obr_efo, "download", fake_download)
    return pages, requested


def test_edition_of():
    assert obr_efo.edition_of(MAR26) == (2026, 3)
    assert obr_efo.edition_of("/efo/economic-and-fiscal-outlook-november-2026") == (2026, 11)
    assert obr_efo.edition_of("https://obr.uk/download/economic-and-fiscal-outlook-march-2026/") is None
    assert obr_efo.edition_of("https://obr.uk/efo/economic-and-fiscal-outlook-spring-2026/") is None
    assert obr_efo.edition_of("https://example.com/efo/economic-and-fiscal-outlook-march-2026/") is None


def test_discovery_picks_newest_edition(fake_site):
    pages, requested = fake_site
    pages[obr_efo.INDEX_URL] = _page(MAR26, [NOV25, NOV26, "https://obr.uk/download/economic-and-fiscal-outlook-march-2026/"])
    pages[NOV26] = _page(NOV26, _workbook_links("november-2026"), "Economic and fiscal outlook &#8211; November 2026", "2026-11-26")
    ed = obr_efo.discover()
    assert (ed.vintage, ed.discovered, ed.published_on) == ("EFO-2026-11", True, date(2026, 11, 26))
    assert ed.title == "OBR Economic and fiscal outlook – November 2026"
    assert ed.files["annex"].endswith("/november-2026-economic-and-fiscal-outlook-charts-and-tables-annex-tables/")
    assert ed.files["debt_interest_rr"].endswith("-debt-interest-ready-reckoner/")
    assert requested == [obr_efo.INDEX_URL, NOV26]


def test_discovery_uses_index_page_when_it_is_the_newest(fake_site):
    pages, requested = fake_site
    pages[obr_efo.INDEX_URL] = _page(MAR26, [NOV25, *_workbook_links("march-2026")], "Economic and fiscal outlook – March 2026", "2026-03-03")
    ed = obr_efo.discover()
    assert ed.vintage == "EFO-2026-03" and ed.discovered and ed.published_on == date(2026, 3, 3)
    assert requested == [obr_efo.INDEX_URL]  # no second request


def test_discovery_skips_edition_without_workbooks(fake_site):
    pages, _ = fake_site
    pages[obr_efo.INDEX_URL] = _page(MAR26, [NOV26, *_workbook_links("march-2026")], "Economic and fiscal outlook – March 2026", "2026-03-03")
    pages[NOV26] = _page(NOV26, [], "Economic and fiscal outlook – November 2026", "2026-11-26")  # tables not out yet
    ed = obr_efo.discover()
    assert ed.vintage == "EFO-2026-03" and ed.discovered


def test_discovery_falls_back_to_march_2026(fake_site, caplog):
    pages, _ = fake_site  # the index page is unreachable
    pages[obr_efo.FALLBACK_URL] = _page(MAR26, _workbook_links("march-2026"), "Economic and fiscal outlook – March 2026", "2026-03-03")
    with caplog.at_level("WARNING", logger=obr_efo.__name__):
        ed = obr_efo.discover()
    assert ed.vintage == "EFO-2026-03" and not ed.discovered
    assert "falling back" in caplog.text


def test_cached_artifacts_picks_newest_complete_edition(monkeypatch, tmp_path):
    folder = tmp_path / obr_efo.SOURCE.id
    folder.mkdir()
    monkeypatch.setattr(obr_efo, "RAW_DIR", tmp_path)
    meta = json.dumps({"url": "u", "sha256": "x", "fetched_at": "2026-10-06T00:00:00+00:00"})

    def put(name):
        (folder / name).write_bytes(b"")
        (folder / f"{name}.meta.json").write_text(meta)

    for suffix in ("annex_tables.xlsx", "debt_interest_ready_reckoner.xlsx"):
        put(f"efo_2026_03_{suffix}")
    put("efo_2026_11_annex_tables.xlsx")  # incomplete newer edition
    assert {r.vintage for r in obr_efo.cached_artifacts()} == {"EFO-2026-03"}
    put("efo_2026_11_debt_interest_ready_reckoner.xlsx")
    assert {r.vintage for r in obr_efo.cached_artifacts()} == {"EFO-2026-11"}
