"""
Checks that run after assembly. Errors fail the build (and CI); warnings are
reported in the manifest and the PR body.

    balance    receipts + borrowing == spending for every year (invariant 4)
    staleness  a source older than its cadence + grace (BUILD_PLAN M1)
    quality    training values left in levers that HMRC/OBR cover (M1 done-criterion)
"""

from __future__ import annotations

import re
from datetime import date

from etl.build import MANUAL_REFRESH, Run, Store

BALANCE_TOLERANCE_BN = 0.1


def vintage_date(vintage: str) -> date | None:
    """Best-effort publication date from a vintage label: 2026-09-18, 2026-09 or 2026."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", vintage)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"(\d{4})-(\d{2})(?!\d)", vintage)
    if m and 1 <= int(m[2]) <= 12:
        return date(int(m[1]), int(m[2]), 1)
    m = re.search(r"(?<!\d)(\d{4})(?!\d)", vintage)
    if m:
        return date(int(m[1]), 1, 1)
    return None


# Known publisher delays, reviewed by a person. Each turns a staleness error into a
# warning until its review date, after which the error comes back.
ACKNOWLEDGED_DELAYS = {
    "hmrc_reckoner": (
        date(2027, 1, 31),
        "HMRC postponed the January 2026 edition of 'Direct effects of illustrative tax changes' (notice of 6 Jul 2026, no new date).",
    ),
}


def staleness(store: Store, run: Run, today: date) -> dict[str, dict]:
    report: dict[str, dict] = {}
    for sid, src in run.sources.items():
        vintages = sorted({o.vintage for (s, p, x), o in store.idx.items() if x == sid})
        if not vintages:
            run.add("staleness", "error", sid, "no observations at all")
            continue
        latest = max(vintages, key=lambda v: ((vintage_date(v) or date.min), v))
        published = src.published_on or vintage_date(latest)
        if published is None:
            run.add("staleness", "warning", sid, f"cannot date vintage {latest!r}")
            report[sid] = {"vintage": latest, "published_on": None}
            continue
        age = (today - published).days
        overdue = age - src.cadence_days
        level = "error" if overdue > src.grace_days else ("warning" if overdue > 0 else None)
        message = f"{latest} is {age} days old; a new edition was due {overdue} days ago (grace {src.grace_days})"
        ack = ACKNOWLEDGED_DELAYS.get(sid)
        if level == "error" and ack and today <= ack[0]:
            level, message = "warning", f"{message}. Acknowledged until {ack[0].isoformat()}: {ack[1]}"
        if level and sid in MANUAL_REFRESH:
            message = f"{message}. {MANUAL_REFRESH[sid]}"
        if level:
            run.add("staleness", level, sid, message, overdue)
        report[sid] = {"vintage": latest, "published_on": published.isoformat(), "age_days": age, "cadence_days": src.cadence_days, "grace_days": src.grace_days, "overdue_days": max(0, overdue)}
    return report


def balance(run: Run, statements: dict[str, dict]) -> None:
    for year, s in statements.items():
        rec = sum(l["bn"] for l in s["receipts"])
        sp = sum(l["bn"] for l in s["spending"])
        gap = rec + s["borrowing_bn"] - sp
        if abs(gap) > BALANCE_TOLERANCE_BN:
            run.add("balance", "error", year, f"receipts + borrowing - spending = {gap:.3f}bn", gap)


def quality(run: Run, outputs: dict) -> None:
    for lever in outputs["levers"]["levers"]:
        if lever["quality"] == "training":
            covered = lever.get("source_id", "").startswith(("hmrc", "obr"))
            run.add("quality", "error" if covered else "warning", f"lever {lever['id']}", "still a training value" + (" although its source is ingested" if covered else ""))
    for year, s in outputs["statements"].items():
        plugs = [l["label"] for l in s["receipts"] + s["spending"] if l.get("plug")]
        if plugs:
            run.add("quality", "warning", year, f"balancing figures: {', '.join(plugs)}")
        training = [l["label"] for l in s["receipts"] + s["spending"] if l["quality"] == "training"]
        if training:
            run.add("quality", "warning", year, f"training values: {', '.join(training)}")


def run_checks(store: Store, run: Run, outputs: dict) -> None:
    outputs["freshness"] = staleness(store, run, date.today())
    balance(run, outputs["statements"])
    quality(run, outputs)
