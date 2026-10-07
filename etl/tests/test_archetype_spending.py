"""Spending of the T1 example households: helpers offline, the real workbooks online (downloaded once, cached 20 h)."""

import json

import pytest

from etl import archetype_spending as spending


def test_cells_keep_ons_symbols():
    assert spending.cell(38.9) == 38.9
    assert spending.cell("1,026.10") == 1026.10
    assert spending.cell("[0.70]") == 0.70  # fewer than 20 households: published, use with caution
    assert spending.cell("..") == ".."  # suppressed
    assert spending.cell(":") == ":"  # nobody recorded any
    with pytest.raises(ValueError):
        spending.cell("n/a")


def test_income_groups_start_at_their_lower_boundary():
    lower = [471, 772, 1122, 1669]  # A26 gross income quintiles, £ a week
    assert spending.group_of(470.99, lower) == 0
    assert spending.group_of(471, lower) == 1
    assert spending.group_of(25_000 / 52, lower) == 1
    assert spending.group_of(120_000 / 52, lower) == 4


@pytest.fixture(scope="module")
def built(request):
    if request.config.getoption("--offline"):
        pytest.skip("needs the ONS Family spending workbooks")
    return spending.build(spending.fetch())


def test_committed_seed_is_what_the_workbooks_give(built):
    committed = json.loads(spending.OUT.read_text())
    committed["meta"].pop("built")
    built["meta"].pop("built")
    assert built == committed


def test_groups_add_up_to_the_published_total(built):
    for aid, a in built["archetypes"].items():
        groups = sum(v["gbp"] for k, v in a["weekly"].items() if k.endswith("_consumption"))
        assert round(groups, 2) == a["total_1_12_week"], aid
        assert all(v["quality"] in ("sourced", "approx") for v in a["weekly"].values())
