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
    assert m.SOURCE.id == m.SOURCE_ID and m.SOURCE.cadence_days == 45 and m.SOURCE.grace_days == 14
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
