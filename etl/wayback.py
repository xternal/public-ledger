"""
Read a publisher's page or file through the Internet Archive when the publisher refuses us.

OBR's Cloudflare answers 403 to GitHub Actions' datacenter addresses but lets the
Internet Archive's crawler in. core.download(..., archive=True) then calls fetch() here:

    1. Save Page Now: GET https://web.archive.org/save/<url>. The archive fetches the URL from
       the publisher now, follows its redirects, and answers 302 to /web/<timestamp>/<final url>.
       This form needs no account (the JSON API does).
    2. Raw replay: GET https://web.archive.org/web/<timestamp>id_/<final url>. "id_" serves the
       publisher's bytes unmodified (no toolbar, no rewritten links); the Memento-Datetime header
       says when the archive captured them. Checked on 2026-10-07: the databank and both EFO
       workbooks replayed byte for byte as OBR serves them.

Freshness, so an old capture can never pass for today's edition:

  * When Save Page Now followed a publisher redirect just now (OBR /download/<name>/ links
    redirect to /docs/<path>.xlsx), the target was resolved live, so the newest capture of that
    exact target is used even if it is older: the archive stores identical bytes once and
    replays the earlier copy (the March 2026 annex tables replay from a 12 May 2026 capture).
    OBR uploads a corrected workbook under a new path, so the path names the bytes.
  * Otherwise the capture of the requested URL itself must be younger than max_age. Landing
    pages, where new editions are found, are always this case.

Anything else raises ArchiveError and the build keeps the committed edition. The archive is
often briefly unavailable ("Temporarily Offline", 429, 503), so each request is retried.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

import httpx

log = logging.getLogger(__name__)

ARCHIVE = "https://web.archive.org"
_SNAPSHOT = re.compile(r"^https?://web\.archive\.org/web/(\d{14})(?:[a-z]{2}_)?/(.+)$")
REDIRECTS = {301, 302, 303, 307, 308}
RETRY_STATUS = {429, 500, 502, 503, 504, 520, 521, 522, 523, 524}
RETRY_DELAYS = (15.0, 60.0)  # seconds before the second and third attempt
MAX_RETRY_AFTER = 120.0
MAX_HOPS = 5
SAVE_TIMEOUT = httpx.Timeout(180.0, connect=20.0)  # Save Page Now fetches the page before it answers

_sleep = time.sleep  # tests replace _sleep and _now


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ArchiveError(Exception):
    """The Internet Archive has no usable copy (unreachable, not captured, or too old)."""


@dataclass
class Capture:
    content: bytes
    original_url: str  # the publisher URL the bytes were captured from
    replay_url: str  # where they were read: https://web.archive.org/web/<timestamp>id_/<original_url>
    captured_at: datetime  # when the archive fetched them from the publisher
    content_type: str | None
    # Every capture the replay passed through, first to last: (publisher URL, capture time).
    chain: list[tuple[str, datetime]] = field(default_factory=list)


def snapshot(url: str) -> tuple[str, str] | None:
    """("20261007123327", "https://obr.uk/data/") from a .../web/<timestamp>[id_]/<url> address."""
    m = _SNAPSHOT.match(url)
    if not m:
        return None
    return m.group(1), re.sub(r"^(https?):/(?!/)", r"\1://", m.group(2))


def same_url(a: str, b: str) -> bool:
    """Same publisher URL, ignoring scheme, "www." and a trailing slash (the archive normalises these)."""

    def key(u: str):
        p = urlparse(u)
        return p.netloc.lower().removeprefix("www."), p.path.rstrip("/"), p.query

    return key(a) == key(b)


def _retry_after(r: httpx.Response) -> float:
    try:
        return float(r.headers.get("retry-after", 0))
    except ValueError:
        return 0.0


def _get(http: httpx.Client, url: str, timeout=httpx.USE_CLIENT_DEFAULT) -> httpx.Response:
    """GET without following redirects, retrying while the archive is busy or offline."""
    delays = list(RETRY_DELAYS)
    while True:
        try:
            r = http.get(url, follow_redirects=False, timeout=timeout)
            if r.status_code not in RETRY_STATUS:
                return r
            problem, wait = f"HTTP {r.status_code}", _retry_after(r)
        except httpx.TransportError as e:
            problem, wait = f"{type(e).__name__}: {e}", 0.0
        if not delays:
            raise ArchiveError(f"{url}: {problem} after {len(RETRY_DELAYS) + 1} attempts")
        wait = min(max(delays.pop(0), wait), MAX_RETRY_AFTER)
        log.info("wayback: %s for %s; retrying in %.0f s", problem, url, wait)
        _sleep(wait)


def save(url: str, http: httpx.Client) -> tuple[str, str] | None:
    """Ask Save Page Now to capture url: (timestamp, final URL after the publisher's redirects), or None."""
    try:
        r = _get(http, f"{ARCHIVE}/save/{url}", timeout=SAVE_TIMEOUT)
    except ArchiveError as e:
        log.warning("wayback: Save Page Now failed for %s: %s", url, e)
        return None
    snap = snapshot(urljoin(ARCHIVE, r.headers.get("location", ""))) if r.status_code in REDIRECTS else None
    if snap is None:
        log.warning("wayback: Save Page Now did not capture %s (HTTP %s)", url, r.status_code)
    return snap


def replay(timestamp: str, url: str, http: httpx.Client) -> Capture:
    """The raw bytes of the capture of url nearest to timestamp, following the redirects it recorded."""
    target = f"{ARCHIVE}/web/{timestamp}id_/{url}"
    chain: list[tuple[str, datetime]] = []
    for _ in range(MAX_HOPS):
        r = _get(http, target)
        memento = r.headers.get("memento-datetime")
        here = snapshot(target)
        if memento:  # a capture; the archive's own "nearest capture" redirects carry no date
            chain.append((here[1], parsedate_to_datetime(memento).astimezone(timezone.utc)))
        if r.status_code in REDIRECTS:
            nxt = snapshot(urljoin(target, r.headers.get("location", "")))
            if nxt is None:
                raise ArchiveError(f"{target}: redirect leaves the archive ({r.headers.get('location')})")
            target = f"{ARCHIVE}/web/{nxt[0]}id_/{nxt[1]}"  # keep raw mode on every hop
            continue
        if r.status_code != 200:
            raise ArchiveError(f"{target}: HTTP {r.status_code}")
        if not memento:
            raise ArchiveError(f"{target}: not an archived capture (no Memento-Datetime)")
        return Capture(r.content, here[1], target, chain[-1][1], r.headers.get("content-type"), chain)
    raise ArchiveError(f"{url}: more than {MAX_HOPS} redirects in the archive")


def fetch(url: str, *, max_age: timedelta, http: httpx.Client) -> Capture:
    """A copy of url from the Internet Archive that is current by the rules in the module docstring."""
    now = _now()
    saved = save(url, http)
    if saved and not same_url(saved[1], url):
        # The publisher redirected and Save Page Now followed it just now: saved[1] is today's target.
        cap = replay(saved[0], saved[1], http)
        if not same_url(cap.chain[0][0], saved[1]):
            raise ArchiveError(f"{url}: the archive answered with a capture of {cap.chain[0][0]}, not {saved[1]}")
        return cap
    cap = replay(saved[0] if saved else now.strftime("%Y%m%d%H%M%S"), url, http)
    first_url, first_at = cap.chain[0]
    if not same_url(first_url, url):
        raise ArchiveError(f"{url}: the archive answered with a capture of {first_url}")
    if now - first_at > max_age:
        raise ArchiveError(f"{url}: the newest archived copy is from {first_at:%Y-%m-%d %H:%M} UTC, older than {max_age}")
    return cap
