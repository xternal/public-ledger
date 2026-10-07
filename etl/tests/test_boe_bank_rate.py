import json
import re
from datetime import date, datetime

import pytest
from bs4 import BeautifulSoup

from etl.core import ROOT, download
from etl.sources import boe_bank_rate as m

SEED = ROOT / "data" / "seed" / "uk_fy2025-26_pnl.json"
HISTORY_URL = "https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp"


@pytest.fixture(scope="module")
def raws(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the BoE files")
    return m.fetch()


@pytest.fixture(scope="module")
def obs(raws):
    return m.parse(raws)


def test_contract(obs):
    assert m.SOURCE.id == m.SOURCE_ID and m.SOURCE.cadence_days == 49 and m.SOURCE.grace_days == 14
    periods = [o.period for o in obs]
    assert periods == sorted(set(periods))
    for o in obs:
        assert o.series_id == "macro.bank_rate" and o.unit == "rate_pct" and o.kind == "outturn"
        assert o.quality == "sourced" and o.source_id == m.SOURCE_ID and o.geography == "UK"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", o.period)
        assert 0 <= o.value <= 25


def test_history_since_2019_is_changes(obs):
    since = [o for o in obs if o.period >= m.HISTORY_START.isoformat()]
    assert len(since) >= 10  # 2020 cuts, 2021-23 rises, 2024-25 cuts
    # Each change differs from the previous level; only the trailing decision point may repeat it.
    for prev, cur in zip(obs, obs[1:]):
        if cur.value == prev.value:
            assert cur is obs[-1] and "held" in (cur.method_note or "")
    assert obs[0].period < m.HISTORY_START.isoformat()  # opening level


def test_matches_boe_bank_rate_history_table(obs):
    """Cross-check the change dates against the BoE 'Bank Rate history' table (Date Changed, Rate)."""
    raw = download(m.SOURCE_ID, HISTORY_URL, "Bank-Rate.html")
    soup = BeautifulSoup(raw.path.read_text(errors="replace"), "html.parser")
    table = next(t for t in soup.find_all("table") if "Date Changed" in t.get_text())
    hist = {}
    for tr in table.find_all("tr")[1:]:
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
        d = datetime.strptime(cells[0], "%d %b %y").date()
        if d >= date(2018, 8, 2):
            hist[d.isoformat()] = float(cells[1])
    ours = {o.period: o.value for o in obs if "held" not in (o.method_note or "")}
    assert ours == hist


def test_latest_decision_present(raws, obs):
    cal = m.mpc_calendar(raws[1])
    latest = obs[-1]
    age = (date.today() - date.fromisoformat(latest.period)).days
    assert age <= m.SOURCE.cadence_days + m.SOURCE.grace_days, f"latest point {latest.period} is {age} days old"
    if "held" in (latest.method_note or ""):
        assert latest.period in {d.isoformat() for d in cal["dates"]}
    if cal["current_rate"] is not None:
        assert cal["current_rate"] == latest.value
    assert cal["next_due"] is None or cal["next_due"] > date.fromisoformat(latest.period)

    seed = json.loads(SEED.read_text())["macro"]
    print(
        f"\nBank Rate: found {latest.value}% at {latest.period} ({latest.method_note or 'change'}); "
        f"last change {[o.period for o in obs if 'held' not in (o.method_note or '')][-1]}; "
        f"next due {cal['next_due']}; seed {seed['bank_rate_pct']}% at {seed['bank_rate_date']}"
    )


# ---------------------------------------------------------------- edition label (network-free)

MPC_2026 = [date(2026, 2, 5), date(2026, 3, 19), date(2026, 4, 30), date(2026, 6, 18),
            date(2026, 7, 30), date(2026, 9, 17), date(2026, 11, 5), date(2026, 12, 17)]
# Bank Rate from each date on (a short made-up history with the real shape).
STEPS = [(date(2018, 1, 1), 0.5), (date(2018, 8, 2), 0.75), (date(2020, 3, 11), 0.25), (date(2025, 12, 18), 3.75)]


def synthetic(tmp_path, until: date, steps=STEPS, mpc=MPC_2026) -> list[m.RawArtifact]:
    """An IADB export (every weekday from 2 Jan 2018 to `until`) and an MPC dates page, as fetch() stores them."""
    from datetime import timedelta

    rows, d = ["DATE,IUDBEDR"], date(2018, 1, 2)
    while d <= until:
        if d.weekday() < 5:
            rows.append(f"{d:%d %b %Y},{[v for s, v in steps if s <= d][-1]}")
        d += timedelta(days=1)
    csv_path = tmp_path / f"IUDBEDR-{until}.csv"
    csv_path.write_text("\n".join(rows) + "\n")
    by_year: dict[int, list[date]] = {}
    for x in mpc:
        by_year.setdefault(x.year, []).append(x)
    html = "".join(f"<h2>{y} confirmed dates</h2><table>" + "".join(f"<tr><td>{x:%A} {x.day} {x:%B}</td></tr>" for x in ds) + "</table>"
                   for y, ds in by_year.items())
    page = tmp_path / "upcoming-mpc-dates.html"
    page.write_text(f"<html><body>{html}</body></html>")
    return [m.RawArtifact(m.SOURCE_ID, m.IADB_CSV_URL, csv_path, "x", "t"),
            m.RawArtifact(m.SOURCE_ID, m.MPC_DATES_URL, page, "x", "t")]


def test_edition_is_named_after_its_newest_point_not_the_last_day(tmp_path):
    """Another business day at the same rate is the same edition: no new file, no nightly pull request."""
    monday, tuesday = m.parse(synthetic(tmp_path, date(2026, 10, 5))), m.parse(synthetic(tmp_path, date(2026, 10, 6)))
    assert [o.model_dump() for o in monday] == [o.model_dump() for o in tuesday]
    assert {o.vintage for o in monday} == {"IADB IUDBEDR as of 2026-09-17"}
    assert monday[-1].period == "2026-09-17" and "held" in monday[-1].method_note


def test_a_new_decision_is_a_new_edition(tmp_path):
    held = m.parse(synthetic(tmp_path, date(2026, 11, 6)))
    assert {o.vintage for o in held} == {"IADB IUDBEDR as of 2026-11-05"}
    assert [(o.period, o.value) for o in held[-2:]] == [("2025-12-18", 3.75), ("2026-11-05", 3.75)]

    cut = m.parse(synthetic(tmp_path, date(2026, 11, 6), STEPS + [(date(2026, 11, 5), 3.5)]))
    assert {o.vintage for o in cut} == {"IADB IUDBEDR as of 2026-11-05"}
    assert (cut[-1].period, cut[-1].value, cut[-1].method_note) == ("2026-11-05", 3.5, None)


def test_staleness_counts_from_the_latest_decision(tmp_path):
    """Seven weeks between decisions is on time; a decision missed by more than the grace period fails the build."""
    from etl.build import Run, Store
    from etl.checks import staleness

    store = Store({m.SOURCE_ID: m.parse(synthetic(tmp_path, date(2026, 10, 5)))})

    def check(today: date):
        run = Run(build_id="test", started_at="test", trigger="test", sources={m.SOURCE_ID: m.SOURCE})
        report = staleness(store, run, today)[m.SOURCE_ID]
        assert report["published_on"] == "2026-09-17"
        return [c.level for c in run.checks]

    assert check(date(2026, 11, 5)) == []           # 49 days: the next decision is due today
    assert check(date(2026, 11, 6)) == ["warning"]  # one day late
    assert check(date(2026, 11, 21)) == ["error"]   # 15 days late, beyond the 14-day grace
