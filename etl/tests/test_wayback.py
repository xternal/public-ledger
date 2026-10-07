"""
The Internet Archive fallback for publishers that refuse GitHub's servers (etl/wayback.py, core.download(archive=True)).

No network: web.archive.org answers from the responses recorded on 2026-10-07 in fixtures/wayback/cassette.json,
and obr.uk answers 403, as it does to GitHub Actions runners. The end-to-end tests run the real OBR modules
through the archive and check that the observations equal the committed ones parsed from OBR directly.

Run: etl/.venv/bin/python -m pytest etl/tests/test_wayback.py -q
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from etl import build, checks, core, publish, summary, wayback
from etl.core import Observation, Source
from etl.sources import obr_databank, obr_efo

FIXTURES = Path(__file__).parent / "fixtures" / "wayback"
CASSETTE = json.loads((FIXTURES / "cassette.json").read_text())
NOW = datetime(2026, 10, 7, 12, 45, tzinfo=timezone.utc)  # just after the recording
DAY = timedelta(hours=20)

DATA_PAGE_COPY = "https://web.archive.org/web/20261007123327id_/https://obr.uk/data/"
DATABANK_LINK = "https://obr.uk/download/public-finances-databank-september-2026/"
DATABANK_FILE = "https://obr.uk/docs/dlm_uploads/PSF_aggregates_databank_Sep-3.xlsx"
DATABANK_COPY = f"https://web.archive.org/web/20261005094056id_/{DATABANK_FILE}"
MAR26 = "https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/"
ANNEX_COPY = "https://web.archive.org/web/20260512224307id_/https://obr.uk/docs/d055fbf02d5b3g6jq8l2/efo-march-2026-charts-and-tables-annex-tables.xlsx"
RR_COPY = "https://web.archive.org/web/20261007124255id_/https://obr.uk/docs/d055fbf02d5b3g6jq8l2/efo-march-2026-detailed-forecast-tables-debt-interest.xlsx"


def recorded(url: str) -> httpx.Response | None:
    for i in CASSETTE["interactions"]:
        if i["url"] == url:
            body = (FIXTURES / i["body"]).read_bytes() if i["body"] else b""
            return httpx.Response(i["status"], headers=i["headers"], content=body)
    return None


def memento(when: datetime) -> str:
    return when.strftime("%a, %d %b %Y %H:%M:%S GMT")


class World:
    """obr.uk refuses us; web.archive.org answers from `routes` first, then from the cassette."""

    def __init__(self):
        self.obr_status = 403
        self.routes: dict[str, list[httpx.Response]] = {}
        self.requests: list[str] = []
        self.sleeps: list[float] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        if request.url.host == "obr.uk":
            return httpx.Response(self.obr_status, text="Sorry, you have been blocked")
        if url in self.routes:
            queue = self.routes[url]
            return queue.pop(0) if len(queue) > 1 else queue[0]
        r = recorded(url)
        if r is None:
            raise httpx.ConnectError(f"unrecorded request {url}")
        return r

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle), headers={"User-Agent": core.USER_AGENT}, follow_redirects=True)

    def to(self, host: str) -> list[str]:
        return [u for u in self.requests if httpx.URL(u).host == host]


@pytest.fixture
def world(monkeypatch, tmp_path):
    w = World()
    monkeypatch.setattr(core, "client", w.client)
    for mod in (core, obr_databank, obr_efo):
        monkeypatch.setattr(mod, "RAW_DIR", tmp_path)
    monkeypatch.setattr(wayback, "_now", lambda: NOW)
    monkeypatch.setattr(wayback, "_sleep", w.sleeps.append)
    # fetch() updates module state to describe the edition it found; put it back afterwards.
    for src in (obr_databank.SOURCE, obr_efo.SOURCE):
        for attr in ("url", "title", "published_on"):
            monkeypatch.setattr(src, attr, getattr(src, attr))
    monkeypatch.setattr(obr_efo, "EDITION", obr_efo.EDITION)
    return w


def committed(source_id: str, vintage: str) -> set[tuple]:
    return {_key(o) for o in build.read_committed(source_id) if o.vintage == vintage}


def _key(o: Observation) -> tuple:
    return (o.series_id, o.period, o.geography, round(o.value, 6), o.unit, o.kind, o.vintage, o.quality, o.method_note or None)


# ------------------------------------------------------------------ end to end through the real OBR modules


def test_databank_through_the_archive(world):
    raws = obr_databank.fetch()
    [raw] = raws
    # Provenance: the publisher URL we asked for stays the artifact's URL; the archive copy is recorded beside it.
    assert raw.url == DATABANK_LINK
    assert raw.fetched_url == DATABANK_COPY
    assert raw.archived_at == "2026-10-05T09:40:56+00:00"
    assert raw.vintage == "OBR-PFD-2026-09"
    # The same bytes as OBR serves (sha256 of the file downloaded directly from obr.uk on 2026-10-06).
    assert raw.sha256 == "9f3c513a6940e6f75dbcc768bc95cdb5dec78fe6d49fdf3662a019645d1a88ed"
    meta = json.loads(raw.path.with_name(raw.path.name + ".meta.json").read_text())
    assert (meta["requested_url"], meta["url"]) == (DATABANK_LINK, DATABANK_FILE)
    # The Observation source still points at OBR, with the date read from the archived data page.
    assert obr_databank.SOURCE.url == "https://obr.uk/data/"
    assert obr_databank.SOURCE.published_on == date(2026, 9, 24)
    assert {_key(o) for o in obr_databank.parse(raws)} == committed("obr_databank", "OBR-PFD-2026-09")
    # Two refusals from OBR, then the archive: Save Page Now and the raw copy for each.
    assert world.to("obr.uk") == ["https://obr.uk/data/", DATABANK_LINK]
    assert f"https://web.archive.org/save/{DATABANK_LINK}" in world.requests
    assert DATA_PAGE_COPY in world.requests and DATABANK_COPY in world.requests


def test_cache_is_keyed_by_the_requested_url(world):
    first = obr_databank.fetch()
    n = len(world.requests)
    again = obr_databank.fetch()
    assert len(world.requests) == n  # no request to OBR or the archive within 20 hours
    assert (again[0].fetched_url, again[0].archived_at, again[0].sha256) == (first[0].fetched_url, first[0].archived_at, first[0].sha256)
    page = core.download(obr_databank.SOURCE.id, "https://obr.uk/data/", obr_databank.PAGE_NAME, archive=True)
    assert (page.url, page.fetched_url) == ("https://obr.uk/data/", DATA_PAGE_COPY)
    assert len(world.requests) == n


def test_efo_through_the_archive(world):
    raws = obr_efo.fetch()
    # /efo/ redirects to the newest edition; Save Page Now followed it, so the edition page is today's.
    assert (obr_efo.SOURCE.url, obr_efo.SOURCE.published_on) == (MAR26, date(2026, 3, 3))
    assert obr_efo.SOURCE.title == "OBR Economic and fiscal outlook – March 2026"
    assert obr_efo.EDITION.discovered
    by_name = {r.path.name: r for r in raws}
    annex, rr = by_name["efo_2026_03_annex_tables.xlsx"], by_name["efo_2026_03_debt_interest_ready_reckoner.xlsx"]
    assert annex.url == "https://obr.uk/download/march-2026-economic-and-fiscal-outlook-charts-and-tables-annex-tables/"
    # The archive replays its May capture of the annex tables: identical bytes, so it stores them once.
    assert (annex.fetched_url, annex.archived_at) == (ANNEX_COPY, "2026-05-12T22:43:07+00:00")
    assert (rr.fetched_url, rr.archived_at) == (RR_COPY, "2026-10-07T12:42:55+00:00")
    assert {_key(o) for o in obr_efo.parse(raws)} == committed("obr_efo", "EFO-2026-03")
    assert len(world.to("obr.uk")) == 3  # /efo/ and the two workbooks; the edition page came with /efo/


# ------------------------------------------------------------------ when not to use the archive


def test_archive_is_opt_in(world):
    with pytest.raises(httpx.HTTPStatusError, match="403"):
        core.download("obr_databank", "https://obr.uk/data/", "page.html")
    assert world.to("web.archive.org") == []


def test_missing_file_is_not_fetched_from_the_archive(world):
    world.obr_status = 404  # gone is not refused: an old copy would hide the problem
    with pytest.raises(httpx.HTTPStatusError, match="404"):
        core.download("obr_databank", "https://obr.uk/data/", "page.html", archive=True)
    assert world.to("web.archive.org") == []


# ------------------------------------------------------------------ freshness and safety


PAGE = "https://example.gov.uk/data/"


def _save_fails(w: World, url: str = PAGE) -> None:
    w.routes[f"https://web.archive.org/save/{url}"] = [httpx.Response(520, text="Job failed")]


def _copy(w: World, timestamp: str, url: str, when: datetime, body: bytes = b"<html>edition</html>") -> None:
    w.routes[f"https://web.archive.org/web/{timestamp}id_/{url}"] = [httpx.Response(200, headers={"memento-datetime": memento(when)}, content=body)]


def test_old_copy_of_a_page_is_refused(world):
    _save_fails(world)
    nearest = NOW.strftime("%Y%m%d%H%M%S")
    world.routes[f"https://web.archive.org/web/{nearest}id_/{PAGE}"] = [
        httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261004080000id_/{PAGE}"})]
    _copy(world, "20261004080000", PAGE, datetime(2026, 10, 4, 8, tzinfo=timezone.utc))
    with pytest.raises(wayback.ArchiveError, match="older than"):
        wayback.fetch(PAGE, max_age=DAY, http=world.client())
    assert world.sleeps == list(wayback.RETRY_DELAYS)  # Save Page Now was retried before giving up


def test_recent_copy_is_used_when_save_page_now_fails(world):
    _save_fails(world)
    nearest = NOW.strftime("%Y%m%d%H%M%S")
    _copy(world, nearest, PAGE, NOW - timedelta(hours=3))
    cap = wayback.fetch(PAGE, max_age=DAY, http=world.client())
    assert cap.captured_at == NOW - timedelta(hours=3) and cap.original_url == PAGE


def test_retries_while_the_archive_is_offline(world):
    url = f"https://web.archive.org/save/{PAGE}"
    world.routes[url] = [httpx.Response(503, text="Temporarily Offline"), httpx.Response(429, headers={"retry-after": "90"}),
                         httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261007124000/{PAGE}"})]
    _copy(world, "20261007124000", PAGE, datetime(2026, 10, 7, 12, 40, tzinfo=timezone.utc))
    cap = wayback.fetch(PAGE, max_age=DAY, http=world.client())
    assert cap.content == b"<html>edition</html>"
    assert world.sleeps == [15.0, 90.0]  # the second wait honours Retry-After


def test_retry_after_is_capped(world):
    url = f"https://web.archive.org/save/{PAGE}"
    world.routes[url] = [httpx.Response(429, headers={"retry-after": "3600"}),
                         httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261007124000/{PAGE}"})]
    _copy(world, "20261007124000", PAGE, datetime(2026, 10, 7, 12, 40, tzinfo=timezone.utc))
    wayback.fetch(PAGE, max_age=DAY, http=world.client())
    assert world.sleeps == [wayback.MAX_RETRY_AFTER]


def test_redirect_out_of_the_archive_is_refused(world):
    world.routes[f"https://web.archive.org/save/{PAGE}"] = [
        httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261007124000/{PAGE}"})]
    world.routes[f"https://web.archive.org/web/20261007124000id_/{PAGE}"] = [
        httpx.Response(302, headers={"location": "https://elsewhere.example/data.xlsx"})]
    with pytest.raises(wayback.ArchiveError, match="leaves the archive"):
        wayback.fetch(PAGE, max_age=DAY, http=world.client())


def test_answer_without_capture_date_is_refused(world):
    world.routes[f"https://web.archive.org/save/{PAGE}"] = [
        httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261007124000/{PAGE}"})]
    world.routes[f"https://web.archive.org/web/20261007124000id_/{PAGE}"] = [httpx.Response(200, text="Wayback Machine has not archived that URL.")]
    with pytest.raises(wayback.ArchiveError, match="Memento-Datetime"):
        wayback.fetch(PAGE, max_age=DAY, http=world.client())


def test_captured_error_page_is_refused(world):
    world.routes[f"https://web.archive.org/save/{PAGE}"] = [
        httpx.Response(302, headers={"location": f"https://web.archive.org/web/20261007124000/{PAGE}"})]
    world.routes[f"https://web.archive.org/web/20261007124000id_/{PAGE}"] = [
        httpx.Response(403, headers={"memento-datetime": memento(NOW)}, text="Sorry, you have been blocked")]
    with pytest.raises(wayback.ArchiveError, match="HTTP 403"):
        wayback.fetch(PAGE, max_age=DAY, http=world.client())


def test_snapshot_and_same_url():
    assert wayback.snapshot("https://web.archive.org/web/20261007123327/https://obr.uk/data/") == ("20261007123327", "https://obr.uk/data/")
    assert wayback.snapshot("https://web.archive.org/web/20261005094056id_/https:/obr.uk/x.xlsx") == ("20261005094056", "https://obr.uk/x.xlsx")
    assert wayback.snapshot("https://obr.uk/data/") is None
    assert wayback.same_url("http://www.obr.uk/data", "https://obr.uk/data/")
    assert not wayback.same_url("https://obr.uk/efo/", MAR26)


# ------------------------------------------------------------------ what people see when it fails


def test_failed_archive_keeps_committed_data_and_says_what_to_do(world, monkeypatch):
    world.routes[f"https://web.archive.org/save/https://obr.uk/data/"] = [httpx.Response(503, text="Temporarily Offline")]
    nearest = NOW.strftime("%Y%m%d%H%M%S")
    world.routes[f"https://web.archive.org/web/{nearest}id_/https://obr.uk/data/"] = [httpx.Response(503, text="Temporarily Offline")]
    monkeypatch.setattr(build, "discover", lambda: [obr_databank])
    run = build.Run(build_id="test", started_at="2026-10-07T04:30:00Z", trigger="test")
    by_source = build.collect(run, offline=False)
    assert by_source["obr_databank"] == build.read_committed("obr_databank")
    [check] = [c for c in run.checks if c.check_id == "fetch"]
    assert check.level == "warning" and check.message.startswith("ArchiveError: https://obr.uk/data/ refused us (403)")
    assert "pnpm etl" in check.message and "docs/OPERATIONS.md" in check.message


def test_staleness_message_names_the_manual_procedure():
    efo = Source(id="obr_efo", title="EFO", publisher="OBR", url=MAR26, published_on=date(2026, 3, 3), cadence_days=245, grace_days=30)
    other = Source(id="boe_bank_rate", title="Bank Rate", publisher="BoE", url="https://www.bankofengland.co.uk/", published_on=date(2026, 3, 3), cadence_days=245, grace_days=30)
    obs = lambda sid: [Observation(series_id="x.y", period="2026-27", value=1, unit="gbp_bn", kind="forecast", source_id=sid, vintage="2026-03", quality="sourced")]
    run = build.Run(build_id="t", started_at="t", trigger="t", sources={"obr_efo": efo, "boe_bank_rate": other})
    checks.staleness(build.Store({"obr_efo": obs("obr_efo"), "boe_bank_rate": obs("boe_bank_rate")}), run, date(2026, 12, 15))
    by_source = {c.subject: c for c in run.checks}
    assert by_source["obr_efo"].level == "error" and "pnpm etl" in by_source["obr_efo"].message
    assert "pnpm etl" not in by_source["boe_bank_rate"].message


def test_history_gains_the_new_columns_without_changing_old_rows(tmp_path):
    path = tmp_path / "artifacts.csv"
    old_fields = publish.ARTIFACT_FIELDS[:-2]
    with path.open("w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(old_fields)
        w.writerow(["b1", "boe_bank_rate", "https://x/?a=1,2", "abc", "10", "2026-10-06T19:50:06+00:00", "", "False"])
    before = path.read_text().splitlines()[1]
    publish._append(path, publish.ARTIFACT_FIELDS, [{"build_id": "b2", "source_id": "obr_databank", "url": DATABANK_LINK,
                                                     "fetched_url": DATABANK_COPY, "archived_at": "2026-10-05T09:40:56+00:00"}])
    lines = path.read_text().splitlines()
    assert lines[0] == ",".join(publish.ARTIFACT_FIELDS)
    assert lines[1] == before + ",,"
    rows = list(csv.DictReader(path.open()))
    assert rows[1]["fetched_url"] == DATABANK_COPY and rows[0]["fetched_url"] == ""


def test_pull_request_lists_files_read_through_the_archive(tmp_path, monkeypatch, capsys):
    raw = core.RawArtifact("obr_databank", DATABANK_LINK, core.ROOT / "data/raw/obr_databank/x.xlsx", "s", "2026-10-07T04:31:00+00:00",
                           None, "OBR-PFD-2026-09", DATABANK_COPY, "2026-10-05T09:40:56+00:00")
    manifest = {"build_id": "b", "status": "ok", "checks": [], "sources": [{"id": "obr_databank", "title": "OBR databank", "files": [raw.to_manifest()]}]}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(summary, "BUILD_DIR", tmp_path)
    monkeypatch.setattr(summary, "changed_files", lambda: [])
    summary.main()
    out = capsys.readouterr().out
    assert "Read through the Internet Archive" in out
    assert f"obr_databank: {DATABANK_LINK} (captured 2026-10-05T09:40:56+00:00, read from {DATABANK_COPY})" in out


def test_fixture_workbooks_are_obrs_files():
    """The recorded copies are the files OBR served directly (sha256 of direct downloads on 2026-10-06)."""
    expected = {
        "obr_databank.xlsx": "9f3c513a6940e6f75dbcc768bc95cdb5dec78fe6d49fdf3662a019645d1a88ed",
        "efo_annex.xlsx": "58a0c59cac93651a477f2c097b0f99b1dbcee417e9b54e0be3c6f92294ba0ad8",
        "efo_rr.xlsx": "4686d4f77ccba84fa895858e45756bb0d8ed647d9f230a7fa4890c51ef9ee27f",
    }
    for name, sha in expected.items():
        assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == sha
