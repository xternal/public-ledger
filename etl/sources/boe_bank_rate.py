"""
Bank of England Bank Rate (IADB series IUDBEDR) and MPC decision dates.

Emits macro.bank_rate (unit rate_pct, kind outturn, geography UK), one
observation per change of Bank Rate, period = the date the new rate took
effect ("YYYY-MM-DD"; since 2006 a change takes effect on the decision day):

  - every change on or after HISTORY_START;
  - the change that set the rate in force on HISTORY_START (2 Aug 2018, 0.75%),
    so a step chart from 2019 has a starting level;
  - the latest MPC decision on or before the last day of data, when the rate
    was held (period = that decision date, method_note says it was a hold).

Decision dates come from the BoE "Monetary Policy Committee dates" page, which
lists the confirmed dates for the current and the next year only, so holds
before that are not recorded: older history is changes only.

The edition is named after its newest point, "IADB IUDBEDR as of 2026-09-17"
(the latest decision, or the latest change), not after the last day of the
daily series: the label then moves only when the data does, so a nightly run
with nothing new writes nothing and opens no pull request. Staleness counts
from that date, so it measures the time since the last decision we have.

Raw files:
  IUDBEDR.csv              IADB CSV export, daily, from 1 Jan 2018 to today
  upcoming-mpc-dates.html  MPC announcement dates (also shows current rate and next due date)
"""

from __future__ import annotations

import csv
import io
import re
import warnings
from datetime import date, datetime

from bs4 import BeautifulSoup

from etl.core import Observation, RawArtifact, Source, download

SOURCE_ID = "boe_bank_rate"
SERIES_CODE = "IUDBEDR"
HISTORY_START = date(2019, 1, 1)
# Download a year earlier than HISTORY_START so the change in force on that date is visible.
IADB_FROM = "01/Jan/2018"

IADB_CSV_URL = (
    "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp"
    f"?csv.x=yes&Datefrom={IADB_FROM}&Dateto=now&SeriesCodes={SERIES_CODE}"
    "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N"
)
MPC_DATES_URL = "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates"

SOURCE = Source(
    id=SOURCE_ID,
    title="Official Bank Rate (IADB series IUDBEDR) and MPC dates",
    publisher="Bank of England",
    url="https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp",
    licence="Bank of England terms of use (https://www.bankofengland.co.uk/legal)",
    # MPC decisions are six or seven weeks apart (at most 49 days), and the edition is dated by the latest one.
    cadence_days=49,
    grace_days=14,
)

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}


def fetch(since: date | None = None) -> list[RawArtifact]:
    return [
        download(SOURCE_ID, IADB_CSV_URL, f"{SERIES_CODE}.csv"),
        download(SOURCE_ID, MPC_DATES_URL, "upcoming-mpc-dates.html"),
    ]


def _pick(raws: list[RawArtifact], needle: str) -> RawArtifact:
    found = [r for r in raws if needle in r.url]
    if len(found) != 1:
        raise ValueError(f"{SOURCE_ID}: expected one raw file whose URL contains {needle!r}, got {len(found)}")
    return found[0]


def daily_rates(raw: RawArtifact) -> list[tuple[date, float]]:
    """Parse the IADB CSV (DATE,IUDBEDR / '02 Jan 2019,0.75') into sorted (date, rate) pairs."""
    text = raw.path.read_text(encoding="utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or [c.strip().upper() for c in rows[0]] != ["DATE", SERIES_CODE]:
        raise ValueError(f"{SOURCE_ID}: unexpected IADB header {rows[:1]!r} (is the export an error page?)")
    out: list[tuple[date, float]] = []
    for row in rows[1:]:
        if not row or not "".join(row).strip():
            continue
        if len(row) != 2:
            raise ValueError(f"{SOURCE_ID}: bad IADB row {row!r}")
        d = datetime.strptime(row[0].strip(), "%d %b %Y").date()
        v = float(row[1])
        if not 0 <= v <= 25:
            raise ValueError(f"{SOURCE_ID}: implausible Bank Rate {v} on {d}")
        out.append((d, v))
    out.sort()
    if len(out) < 200:
        raise ValueError(f"{SOURCE_ID}: only {len(out)} daily rows in the IADB export")
    return out


def changes(daily: list[tuple[date, float]]) -> list[tuple[date, float]]:
    """Dates on which the rate differs from the previous business day, with the new rate."""
    return [(d, v) for (d0, v0), (d, v) in zip(daily, daily[1:]) if v != v0]


def mpc_calendar(raw: RawArtifact) -> dict:
    """
    Parse the MPC dates page: {"dates": [date, ...], "current_rate": float | None, "next_due": date | None}.
    Each table follows an <h2>YYYY confirmed dates</h2>; cells read "Thursday 5 February".
    """
    soup = BeautifulSoup(raw.path.read_text(encoding="utf-8", errors="replace"), "html.parser")
    dates: list[date] = []
    for h in soup.find_all(["h2", "h3"]):
        m = re.fullmatch(r"(\d{4}) confirmed dates", " ".join(h.get_text(" ").split()), re.I)
        if not m:
            continue
        year = int(m.group(1))
        table = h.find_next("table")
        if table is None:
            raise ValueError(f"{SOURCE_ID}: no table after {h.get_text(strip=True)!r}")
        for tr in table.find_all("tr"):
            cell = tr.find(["td", "th"])
            if cell is None:
                continue
            dm = re.search(r"(\d{1,2})\s+([A-Za-z]+)", " ".join(cell.get_text(" ").split()))
            if not dm or dm.group(2).lower() not in MONTHS:
                raise ValueError(f"{SOURCE_ID}: cannot read MPC date from {cell.get_text(strip=True)!r}")
            dates.append(date(year, MONTHS[dm.group(2).lower()], int(dm.group(1))))
    if not dates:
        raise ValueError(f"{SOURCE_ID}: no 'YYYY confirmed dates' tables on the MPC dates page")

    text = " ".join(soup.get_text(" ").split())
    current = re.search(r"Current Bank Rate\s+(\d+(?:\.\d+)?)%", text)
    nxt = re.search(r"Next due:\s*(\d{1,2}) ([A-Za-z]+) (\d{4})", text)
    next_due = None
    if nxt and nxt.group(2).lower() in MONTHS:
        next_due = date(int(nxt.group(3)), MONTHS[nxt.group(2).lower()], int(nxt.group(1)))
    return {
        "dates": sorted(set(dates)),
        "current_rate": float(current.group(1)) if current else None,
        "next_due": next_due,
    }


def parse(raws: list[RawArtifact]) -> list[Observation]:
    csv_raw = _pick(raws, f"SeriesCodes={SERIES_CODE}")
    mpc_raw = _pick(raws, "upcoming-mpc-dates")
    daily = daily_rates(csv_raw)
    last_day = daily[-1][0]

    all_changes = changes(daily)
    before = [c for c in all_changes if c[0] < HISTORY_START]
    after = [c for c in all_changes if c[0] >= HISTORY_START]
    points: list[tuple[date, float, str | None]] = []
    if before:
        d, v = before[-1]
        points.append((d, v, f"Change in force on {HISTORY_START.isoformat()} (opening level of the series)."))
    points += [(d, v, None) for d, v in after]

    decided = [d for d in mpc_calendar(mpc_raw)["dates"] if d <= last_day]
    if not decided:
        warnings.warn(f"{SOURCE_ID}: no MPC decision on the dates page falls on or before {last_day}; only changes recorded")
    else:
        latest = decided[-1]
        if latest not in {d for d, _, _ in points}:
            rate = [v for d, v in daily if d <= latest][-1]
            points.append((latest, rate, "MPC decision date: Bank Rate held (not a change)."))
    if not points:
        raise ValueError(f"{SOURCE_ID}: no change of Bank Rate in the IADB export")
    points.sort(key=lambda p: p[0])

    # Named after the newest point, not last_day: the daily series grows every business day with the same rate.
    vintage = f"IADB {SERIES_CODE} as of {points[-1][0].isoformat()}"
    return [
        Observation(
            series_id="macro.bank_rate", period=d.isoformat(), geography="UK", value=v,
            unit="rate_pct", kind="outturn", source_id=SOURCE_ID, vintage=vintage,
            quality="sourced", method_note=note,
        )
        for d, v, note in points
    ]
