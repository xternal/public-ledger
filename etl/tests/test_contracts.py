"""Contracts behind delivery (M6b): reading OCDS records and keeping snapshots append-only, offline."""

import json
from datetime import date
from pathlib import Path

import pytest

from etl import contracts
from etl.contracts import ContractError, Ref, merge, parse_cf, parse_fts, record_url, refs

FIXTURES = Path(__file__).parent / "fixtures" / "contracts"
FTS_OCID = "ocds-h6vhtk-0525b3"
CF_OCID = "ocds-b5fd17-d7d85349-e804-415b-968b-b7fd2fe98fd5"
CF_NOTICE = "https://www.contractsfinder.service.gov.uk/Notice/69eb20f9-3534-4eba-a223-4cedc2330e41"


def fts_record() -> dict:
    return json.loads((FIXTURES / f"fts_record_{FTS_OCID}.json").read_text())


def cf_notice() -> dict:
    return json.loads((FIXTURES / "cf_notice_69eb20f9.json").read_text())


def test_refs_reads_card_links(tmp_path):
    (tmp_path / "a.yaml").write_text(f"id: a\ncontracts:\n  - {FTS_OCID}\n  - ocid: {CF_OCID}\n    notice_url: {CF_NOTICE}\n")
    (tmp_path / "b.yaml").write_text(f"id: b\ncontracts:\n  - {FTS_OCID}\n  - ocid: ocds-h6vhtk-000001\n    award_id: '2'\n")
    (tmp_path / "c.yaml").write_text("id: c\n")
    got = refs(tmp_path)
    assert [r.key for r in got] == [FTS_OCID, CF_OCID, "ocds-h6vhtk-000001--award-2"]
    assert got[0].promise_id == "a"  # the first card to link a contract names it
    assert [r.source for r in got] == ["find_a_tender", "contracts_finder", "find_a_tender"]


def test_record_urls():
    assert record_url(Ref("a", FTS_OCID)) == f"https://www.find-tender.service.gov.uk/api/1.0/ocdsRecordPackages/{FTS_OCID}"
    assert record_url(Ref("a", CF_OCID, notice_url=CF_NOTICE)).endswith("/get_published_notice/json/69eb20f9-3534-4eba-a223-4cedc2330e41")
    with pytest.raises(ContractError, match="notice_url"):
        record_url(Ref("a", CF_OCID))
    with pytest.raises(ContractError):
        Ref("a", "ocds-zzzzzz-1").source


def test_parse_find_a_tender_record():
    got = parse_fts(fts_record(), Ref("a", FTS_OCID))
    assert got["title"] == "Murton MOD Area Victor West Peatland Restoration Project"
    assert got["buyer"] == "Durham County Council"
    assert got["supplier"] == {"name": "Dinsdale Moorland Specialists Ltd", "companies_house_number": "09442333"}
    assert got["value"] == {"amount": 395493.0, "currency": "GBP"}  # net of VAT, as the contract states it
    assert got["end_date_planned"] == "2027-03-31"
    assert "end_date_actual" not in got
    assert got["awarded_on"] == "2026-09-30"
    assert got["notice_url"] == "https://www.find-tender.service.gov.uk/Notice/092299-2026"


def test_a_terminated_contract_has_ended():
    rec = fts_record()
    rec["records"][0]["compiledRelease"]["contracts"][0]["status"] = "terminated"
    assert parse_fts(rec, Ref("a", FTS_OCID))["end_date_actual"] == "2027-03-31"


def test_several_awards_need_an_award_id():
    rec = fts_record()
    c = rec["records"][0]["compiledRelease"]
    c["awards"].append({**c["awards"][0], "id": "2"})
    with pytest.raises(ContractError, match="several awards"):
        parse_fts(rec, Ref("a", FTS_OCID))
    assert parse_fts(rec, Ref("a", FTS_OCID, award_id="1"))["supplier"]["name"] == "Dinsdale Moorland Specialists Ltd"


def test_parse_contracts_finder_notice():
    got = parse_cf(cf_notice(), Ref("a", CF_OCID, notice_url=CF_NOTICE))
    assert got["buyer"] == "City of London Corporation"
    assert got["supplier"] == {"name": "Stagecast Limited"}
    assert got["value"] == {"amount": 49000.0, "currency": "GBP"}
    assert got["end_date_planned"] == "2025-06-25"
    assert got["awarded_on"] == "2024-06-12"
    assert got["notice_url"] == CF_NOTICE


def test_a_new_contract_gets_its_first_snapshot():
    ref = Ref("a", FTS_OCID)
    out = merge(None, ref, parse_fts(fts_record(), ref), date(2026, 10, 8), record_url(ref))
    assert out["key"] == FTS_OCID and out["source"] == "find_a_tender"
    assert out["snapshots"] == [{"fetched_at": "2026-10-08", "value": {"amount": 395493.0, "currency": "GBP"}, "end_date_planned": "2027-03-31"}]


def test_no_change_no_snapshot_and_a_change_appends_one():
    """Done when (M6b): a changed value in the source produces a new snapshot; published ones stay as they were."""
    ref = Ref("a", FTS_OCID)
    first = merge(None, ref, parse_fts(fts_record(), ref), date(2026, 10, 8), record_url(ref))
    same = merge(first, ref, parse_fts(fts_record(), ref), date(2026, 10, 9), record_url(ref))
    assert same == first

    rec = fts_record()
    k = rec["records"][0]["compiledRelease"]["contracts"][0]
    k["value"]["amount"] = 450000
    k["period"]["endDate"] = "2027-09-30T23:59:59+01:00"
    changed = merge(same, ref, parse_fts(rec, ref), date(2027, 2, 1), record_url(ref))
    assert changed["snapshots"][0] == first["snapshots"][0]
    assert changed["snapshots"][1] == {"fetched_at": "2027-02-01", "value": {"amount": 450000.0, "currency": "GBP"}, "end_date_planned": "2027-09-30"}


def test_run_offline_writes_files(tmp_path, monkeypatch):
    promises = tmp_path / "promises"
    promises.mkdir()
    (promises / "a.yaml").write_text(f"id: a\ncontracts:\n  - {FTS_OCID}\n  - ocds-h6vhtk-999999\n")
    raw = tmp_path / "raw" / "contracts"
    raw.mkdir(parents=True)
    (raw / f"{FTS_OCID}.json").write_text((FIXTURES / f"fts_record_{FTS_OCID}.json").read_text())
    monkeypatch.setattr(contracts, "PROMISES_DIR", promises)
    monkeypatch.setattr(contracts, "CONTRACTS_DIR", tmp_path / "build" / "contracts")
    monkeypatch.setattr(contracts, "RAW_DIR", tmp_path / "raw")
    monkeypatch.setattr(contracts, "refs", lambda: refs(promises))

    written, problems = contracts.run(offline=True, today=date(2026, 10, 8))
    assert written == 1
    assert problems == ["ocds-h6vhtk-999999 (for a): ocds-h6vhtk-999999: no stored record to read offline"]
    saved = json.loads((tmp_path / "build" / "contracts" / f"{FTS_OCID}.json").read_text())
    assert saved["supplier"]["companies_house_number"] == "09442333"

    # A second run with nothing new writes nothing.
    assert contracts.run(offline=True, today=date(2026, 10, 9)) == (0, problems)
