"""HMRC Table 2.1 (number of individual Income Tax payers): parse the real published file."""

from __future__ import annotations

import re
from datetime import timedelta

import httpx
import pytest

from etl import core
from etl.sources import hmrc_taxpayers as mod


def _no_network(request):
    raise httpx.ConnectError("offline: not in data/raw", request=request)


@pytest.fixture(scope="module")
def raws(request):
    if not request.config.getoption("--offline"):
        return mod.fetch(None)
    offline_http = httpx.Client(transport=httpx.MockTransport(_no_network))
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod, "download", lambda *a, **k: core.download(*a, max_age=timedelta(days=3650), http=offline_http, **k))
        try:
            return mod.fetch(None)
        except httpx.ConnectError:
            pytest.skip("offline and HMRC Table 2.1 is not cached in data/raw")


@pytest.fixture(scope="module")
def obs(raws):
    return mod.parse(raws)


def series(obs, sid):
    return {o.period: o for o in obs if o.series_id == sid}


def test_fields_and_vintage(obs):
    assert obs
    for o in obs:
        assert o.unit == "persons_m" and o.quality == "sourced" and o.source_id == "hmrc_taxpayers"
        assert re.fullmatch(r"\d{4}-\d{2}", o.period)
        assert o.kind in ("outturn", "projection")
        assert re.fullmatch(r"HMRC-ITLS-\d{4}-\d{2}", o.vintage)
    assert len({(o.series_id, o.period) for o in obs}) == len(obs)


def test_all_taxpayers_recent_years(obs):
    allp = series(obs, "people.income_taxpayers")
    latest = max(allp)
    assert latest >= "2025-26"
    assert "1990-91" in allp and allp["1990-91"].kind == "outturn"
    for p, o in allp.items():
        assert 20 <= o.value <= 50, (p, o.value)
    # Outturn years come first, projections after, with no gap in kinds.
    kinds = [allp[p].kind for p in sorted(allp)]
    assert "projection" in kinds and "outturn" in kinds
    assert kinds == sorted(kinds, key=lambda k: k == "projection")
    assert allp[latest].kind == "projection"


def test_rate_split_adds_up(obs):
    allp = series(obs, "people.income_taxpayers")
    parts = [series(obs, f"people.income_taxpayers.{r}") for r in ("basic_rate", "higher_rate", "additional_rate")]
    for p in ("2023-24", max(allp)):
        total = sum(s[p].value for s in parts)
        # Savers-rate payers are outside the three columns; HMRC rounds to 3 s.f.
        assert 0.95 * allp[p].value <= total <= allp[p].value + 0.2, (p, total, allp[p].value)
