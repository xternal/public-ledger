"""
Contracts behind delivery (M6b): python -m etl.contracts

Editors link a promise card to the public contracts that carry it out, by hand,
in its YAML:

    contracts:
      - ocds-h6vhtk-0525b3                       # Find a Tender: the OCID is enough
      - ocid: ocds-h6vhtk-04a1b2
        award_id: "2"                            # when the procurement awarded several contracts (lots)
      - ocid: ocds-b5fd17-<guid>
        notice_url: https://www.contractsfinder.service.gov.uk/Notice/<notice id>   # Contracts Finder

Nothing is matched automatically. For every linked contract this module
fetches the open contracting (OCDS) record and keeps
data/build/contracts/<key>.json: who bought, who won, bids received, when it
was awarded, and snapshots of value and dates. A snapshot is appended only
when the value or an end date changed since the last one, and published
snapshots are never edited (`pnpm validate --base` checks it). The nightly
data job runs this, so a change in a contract arrives as a data-refresh pull
request with a new snapshot.

Find a Tender (the Central Digital Platform, where every notice under the
Procurement Act 2023 has gone since 24 Feb 2025, and above-threshold notices
before that): GET /api/1.0/ocdsRecordPackages/<ocid> returns the compiled
record. Contracts Finder (below-threshold notices before 24 Feb 2025) has no
lookup by OCID, so its link names the notice, read from
/api/rest/2/get_published_notice/json/<notice id>.

Raw records go to data/raw/contracts/ (gitignored): Contracts Finder notices
name the buyer's contact person, so only the fields below are kept.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
import yaml

from etl import wayback
from etl.core import BUILD_DIR, RAW_DIR, ROOT, client, download

log = logging.getLogger(__name__)

PROMISES_DIR = ROOT / "content" / "promises"
CONTRACTS_DIR = BUILD_DIR / "contracts"
RAW_SOURCE_ID = "contracts"

FTS = "https://www.find-tender.service.gov.uk"
CF = "https://www.contractsfinder.service.gov.uk"
FTS_PREFIX = "ocds-h6vhtk-"
CF_PREFIX = "ocds-b5fd17-"
COMPANIES_HOUSE = re.compile(r"^[A-Z0-9]{8}$")
CF_NOTICE = re.compile(r"/Notice/([0-9a-f-]{36})", re.I)
# Bid counts that mean "tenders received", in the order we prefer them.
BID_MEASURES = ("bids", "validBids", "tenders", "electronicBids")


class ContractError(Exception):
    """A linked contract could not be read; the build reports it and keeps the committed file."""


@dataclass(frozen=True)
class Ref:
    promise_id: str
    ocid: str
    award_id: str | None = None
    notice_url: str | None = None

    @property
    def key(self) -> str:
        return f"{self.ocid}--award-{self.award_id}" if self.award_id else self.ocid

    @property
    def source(self) -> str:
        if self.ocid.startswith(FTS_PREFIX):
            return "find_a_tender"
        if self.ocid.startswith(CF_PREFIX):
            return "contracts_finder"
        raise ContractError(f"{self.ocid}: not a Find a Tender or Contracts Finder OCID")


def refs(promises_dir: Path = PROMISES_DIR) -> list[Ref]:
    """Every contract link in the cards, in file order, once per contract."""
    out: dict[str, Ref] = {}
    for path in sorted(promises_dir.glob("*.yaml")):
        card = yaml.safe_load(path.read_text()) or {}
        for item in card.get("contracts") or []:
            r = Ref(card["id"], item) if isinstance(item, str) else Ref(card["id"], item["ocid"], item.get("award_id"), item.get("notice_url"))
            out.setdefault(r.key, r)
    return list(out.values())


def record_url(ref: Ref) -> str:
    if ref.source == "find_a_tender":
        return f"{FTS}/api/1.0/ocdsRecordPackages/{ref.ocid}"
    m = CF_NOTICE.search(ref.notice_url or "")
    if not m:
        raise ContractError(f"{ref.ocid}: a Contracts Finder link needs notice_url (…/Notice/<notice id>)")
    return f"{CF}/api/rest/2/get_published_notice/json/{m.group(1)}"


def _day(iso: str | None) -> str | None:
    return iso[:10] if iso else None


def _amount(v) -> float | None:
    if isinstance(v, dict):
        a = v.get("amount", v.get("amountGross"))
        return float(a) if a is not None else None
    return float(v) if isinstance(v, (int, float)) else None


def parse_fts(package: dict, ref: Ref) -> dict:
    """The fields we keep, from a Find a Tender record package."""
    records = package.get("records") or []
    if not records:
        raise ContractError(f"{ref.ocid}: Find a Tender has no record")
    c = records[0].get("compiledRelease") or {}
    awards = [a for a in c.get("awards") or [] if a.get("status") in (None, "active", "pending")]
    if ref.award_id:
        awards = [a for a in awards if str(a.get("id")) == ref.award_id]
    if len(awards) != 1:
        ids = ", ".join(str(a.get("id")) for a in c.get("awards") or [])
        raise ContractError(f"{ref.ocid}: {'no award yet' if not awards else 'several awards'} ({ids or 'none'}); name award_id in the card")
    award = awards[0]
    contracts = [k for k in c.get("contracts") or [] if str(k.get("awardID")) == str(award.get("id"))]
    contract = contracts[0] if contracts else {}

    supplier = (award.get("suppliers") or [{}])[0]
    party = next((p for p in c.get("parties") or [] if p.get("id") == supplier.get("id")), {})
    ids = [party.get("identifier") or {}, *(party.get("additionalIdentifiers") or [])]
    ch = next((str(i.get("id")) for i in ids if i.get("scheme") == "GB-COH"), None)
    if not ch and str(supplier.get("id", "")).startswith("GB-COH-"):
        ch = supplier["id"].removeprefix("GB-COH-")

    value = _amount(contract.get("value")) if contract.get("value") else _amount(award.get("value"))
    currency = (contract.get("value") or award.get("value") or {}).get("currency", "GBP")
    period = contract.get("period") or award.get("contractPeriod") or {}
    end_planned = _day(period.get("endDate"))
    if value is None or not end_planned:
        raise ContractError(f"{ref.ocid}: the record has no contract value or end date yet")
    # OCDS "terminated": the contract has ended (completed or cut short), so its period end is the actual end.
    end_actual = end_planned if contract.get("status") == "terminated" else None

    releases = records[0].get("releases") or []
    award_releases = [r for r in releases if {"award", "contract", "awardUpdate", "contractUpdate"} & set(r.get("tag") or [])]
    notice_id = (award_releases or releases or [{}])[-1].get("id")
    docs = [d for d in (contract.get("documents") or []) + (award.get("documents") or []) if str(d.get("url", "")).startswith(f"{FTS}/Notice/")]
    notice_url = docs[-1]["url"] if docs else f"{FTS}/Notice/{notice_id}"

    awarded_on = _day(award.get("date")) or _day(contract.get("dateSigned")) or _day((award_releases or [{}])[0].get("date"))
    lot = (award.get("relatedLots") or [None])[0]
    stats = [s for s in (c.get("bids") or {}).get("statistics") or [] if not lot or s.get("relatedLot") in (None, lot)]
    bids = next((int(s["value"]) for m in BID_MEASURES for s in stats if s.get("measure") == m and s.get("value") is not None), None)

    return {
        "title": contract.get("title") or award.get("title") or (c.get("tender") or {}).get("title") or ref.ocid,
        "buyer": (c.get("buyer") or {}).get("name") or "Not stated",
        "notice_url": notice_url,
        "supplier": {"name": supplier.get("name") or party.get("name") or "Not stated", **({"companies_house_number": ch} if ch and COMPANIES_HOUSE.match(ch) else {})},
        "awarded_on": awarded_on,
        **({"bids_received": bids} if bids is not None else {}),
        "value": {"amount": value, "currency": currency},
        "end_date_planned": end_planned,
        **({"end_date_actual": end_actual} if end_actual else {}),
    }


def parse_cf(notice: dict, ref: Ref) -> dict:
    """The fields we keep, from a Contracts Finder notice (never its contact details)."""
    n = notice.get("notice") or {}
    awards = notice.get("awards") or []
    if ref.award_id:
        awards = [a for a in awards if str(a.get("id")) == ref.award_id]
    if len(awards) != 1:
        raise ContractError(f"{ref.ocid}: {'no award' if not awards else 'several awards'} on the notice; name award_id in the card")
    a = awards[0]
    end_planned = _day(a.get("endDate") or n.get("end"))
    value = _amount(a.get("supplierAwardedValue") if a.get("supplierAwardedValue") is not None else a.get("value"))
    if value is None or not end_planned:
        raise ContractError(f"{ref.ocid}: the notice has no awarded value or end date")
    ch = (a.get("reference") or "").strip().upper() if a.get("referenceType") == "COMPANIES_HOUSE" else ""
    return {
        "title": n.get("title") or ref.ocid,
        "buyer": n.get("organisationName") or (notice.get("organisation") or {}).get("name") or "Not stated",
        "notice_url": ref.notice_url,
        "supplier": {"name": a.get("supplierName") or "Not stated", **({"companies_house_number": ch} if COMPANIES_HOUSE.match(ch) else {})},
        "awarded_on": _day(a.get("awardedDate")) or _day(n.get("publishedDate")),
        "value": {"amount": value, "currency": "GBP"},
        "end_date_planned": end_planned,
    }


SNAPSHOT_FIELDS = ("value", "end_date_planned", "end_date_actual")


def merge(existing: dict | None, ref: Ref, current: dict, today: date, record: str, archived_url: str | None = None) -> dict:
    """
    The contract file after today's fetch. Descriptive fields are refreshed;
    a snapshot is appended only when value or dates differ from the last one.
    Published snapshots are copied as they are.
    """
    snap = {"fetched_at": today.isoformat(), **{k: current[k] for k in SNAPSHOT_FIELDS if k in current}}
    snapshots = list((existing or {}).get("snapshots") or [])
    last = snapshots[-1] if snapshots else None
    if last is None or any(last.get(k) != snap.get(k) for k in SNAPSHOT_FIELDS):
        snapshots.append(snap)
    out = {
        "key": ref.key,
        "ocid": ref.ocid,
        **({"award_id": ref.award_id} if ref.award_id else {}),
        "source": ref.source,
        "title": current["title"],
        "buyer": current["buyer"],
        "notice_url": current["notice_url"],
        **({"archived_url": archived_url} if archived_url else {}),
        "record_url": record,
        "supplier": current["supplier"],
        "awarded_on": current["awarded_on"],
        **({"bids_received": current["bids_received"]} if "bids_received" in current else {}),
        "snapshots": snapshots,
    }
    return out


def fetch(ref: Ref, http: httpx.Client, offline: bool) -> dict:
    url = record_url(ref)
    name = f"{ref.key}.json"
    if offline:
        path = RAW_DIR / RAW_SOURCE_ID / name
        if not path.exists():
            raise ContractError(f"{ref.key}: no stored record to read offline")
        raw = json.loads(path.read_text())
    else:
        raw = json.loads(download(RAW_SOURCE_ID, url, name, http=http).path.read_text())
    return parse_fts(raw, ref) if ref.source == "find_a_tender" else parse_cf(raw, ref)


def run(*, offline: bool = False, today: date | None = None, archive: bool = True) -> tuple[int, list[str]]:
    """Fetch every linked contract; returns (files written, problems)."""
    today = today or date.today()
    problems: list[str] = []
    written = 0
    http = client()
    try:
        for ref in refs():
            path = CONTRACTS_DIR / f"{ref.key}.json"
            existing = json.loads(path.read_text()) if path.exists() else None
            try:
                current = fetch(ref, http, offline)
            except (ContractError, httpx.HTTPError, ValueError) as e:
                problems.append(f"{ref.key} (for {ref.promise_id}): {e}")
                continue
            archived = (existing or {}).get("archived_url")
            if not archived and archive and not offline:
                # Once per contract: ask the Internet Archive to keep a copy of the notice.
                snap = wayback.save(current["notice_url"], http)
                archived = f"{wayback.ARCHIVE}/web/{snap[0]}/{snap[1]}" if snap else None
            data = merge(existing, ref, current, today, record_url(ref), archived)
            if data != existing:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
                written += 1
    finally:
        http.close()
    return written, problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--offline", action="store_true", help="read stored records only; no network")
    p.add_argument("--no-archive", action="store_true", help="skip asking the Internet Archive to save each notice")
    p.add_argument("--today", type=date.fromisoformat, help="date for new snapshots (tests)")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    written, problems = run(offline=args.offline, today=args.today, archive=not args.no_archive)
    for line in problems:
        log.warning("contracts: %s", line)
    log.info("contracts: %d file(s) written, %d problem(s)", written, len(problems))
    # A contract that cannot be read keeps its committed file; the run still succeeds so other data refreshes.
    return 0


if __name__ == "__main__":
    sys.exit(main())
