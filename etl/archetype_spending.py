"""
Spending of the T1 example households (ARCHETYPES in packages/schema/src/t1.ts)
from ONS "Family spending in the UK", written to data/seed/archetype_spending.json.

    python -m etl.archetype_spending

Run by hand when ONS publishes a new edition (each June): update EDITION,
EDITION_TITLE, PUBLISHED and BULLETIN, check the row choices below still hold,
run, review the diff, then update the edition named in apps/web/lib/t1-copy.ts
and bump T1_CACHE_VERSION (packages/server/src/model/service.ts) so cached T1
results are computed again. Three requests (one per workbook), cached 20 h in
data/raw/ons_family_spending/.

PolicyEngine UK taxes what a household spends: VAT on the twelve COICOP groups
(its *_consumption inputs) and fuel duty on petrol and diesel. Without them a
VAT or fuel duty change leaves an example household unchanged.

How each value is chosen (recorded per value in the seed):
- Groups 1 to 12: ONS's average weekly spending for the household composition
  closest to the archetype (Table A23), or, for one adult not retired, the same
  composition split by gross income quintile (Table A26), so the three singles
  differ by income. "sourced".
- A group ONS suppresses for that row ("..", fewer than 10 households recording
  it): the row's published 1-12 total less its other groups, so the twelve
  inputs add up to ONS's total; split between the suppressed groups in the
  proportions of a broader published row. "approx".
- A group ONS marks ":" (no household recorded any): zero. "sourced".
- Motor fuel: ONS publishes it by income, not by household composition. The
  archetype's own transport spending times motor fuel's share of transport in
  its gross income decile (Table A6), split into petrol and diesel as all
  households split it (Table A1). "approx".
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import openpyxl

from etl.core import ROOT, download, write_json

EDITION = "fye2025"
EDITION_TITLE = "Family spending in the UK: April 2024 to March 2025"
PUBLISHED = date(2026, 6, 11)
BULLETIN = "https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/bulletins/familyspendingintheuk/april2024tomarch2025"
DATASETS = "https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets"
OUT = ROOT / "data" / "seed" / "archetype_spending.json"
SOURCE_ID = "ons_family_spending"

WORKBOOKS = {
    "ons_fs_wb1": ("familyspendingworkbook1detailedexpenditureandtrends", "workbook1detailedexpenditureandtrends.xlsx", "Family spending workbook 1: detailed expenditure and trends"),
    "ons_fs_wb2": ("familyspendingworkbook2expenditurebyincome", "workbook2expenditurebyincome.xlsx", "Family spending workbook 2: expenditure by income"),
    "ons_fs_wb4": ("familyspendingworkbook4expenditurebyhouseholdcharacteristic", "workbook4expenditurebyhouseholdcharacteristics.xlsx", "Family spending workbook 4: expenditure by household characteristic"),
}

# COICOP group (column A of the ONS tables) -> PolicyEngine UK household input (£ a year).
GROUPS = {
    "1": "food_and_non_alcoholic_beverages_consumption",
    "2": "alcohol_and_tobacco_consumption",
    "3": "clothing_and_footwear_consumption",
    "4": "housing_water_and_electricity_consumption",
    "5": "household_furnishings_consumption",
    "6": "health_consumption",
    "7": "transport_consumption",
    "8": "communication_consumption",
    "9": "recreation_consumption",
    "10": "education_consumption",
    "11": "restaurants_and_hotels_consumption",
    "12": "miscellaneous_consumption",
}
FUEL = {"7.2.2.1": "petrol_spending", "7.2.2.2": "diesel_spending"}

# Gross weekly household income in 2025-26 (earnings and benefits, as ONS
# defines gross income), to place each archetype in ONS's income groups.
# Benefits are PolicyEngine's current-law answers for the same households
# (packages/server/test/fixtures/t1/pe-households-baseline-2025.json).
INCOME = {
    "single_25k": (25_000, "£25,000 earnings"),
    "single_45k": (45_000, "£45,000 earnings"),
    "single_120k": (120_000, "£120,000 earnings"),
    "couple_two_children": (50_000 + 2_251.60, "£50,000 earnings and £2,251.60 Child Benefit"),
    "lone_parent": (18_000 + 5_120.57, "£18,000 earnings and £5,120.57 Universal Credit and Child Benefit"),
    "pensioner_couple": (2 * 11_973 + 199.96, "two full new State Pensions (£11,973 each) and £199.96 Winter Fuel Payment"),
}

# The row (table, column) for each archetype; A26 columns are picked by income.
# `split` is the published column whose proportions share out suppressed groups.
ROWS = {
    "single_25k": {"table": "A26", "by_income": True, "split": ("A26", "All households")},
    "single_45k": {"table": "A26", "by_income": True, "split": ("A26", "All households")},
    "single_120k": {"table": "A26", "by_income": True, "split": ("A26", "All households")},
    "couple_two_children": {"table": "A23", "column": "Two adults with two children", "split": ("A56", "All households")},
    "lone_parent": {"table": "A23", "column": "One adult with one child", "split": ("A56", "All households")},
    "pensioner_couple": {"table": "A23", "column": "Retired, mainly dependent on state pensions: two adults", "split": None},
}

# A23 has three header rows per column; these are the columns used, checked
# against the header text so a new layout fails loudly instead of misreading.
A23_COLUMNS = {
    "Retired, mainly dependent on state pensions: two adults": ("F", ["State pension", "Two", "adults"]),
    "One adult with one child": ("N", ["One adult", "with", "one", "child"]),
    "Two adults with two children": ("R", ["Two adults", "with", "two", "children"]),
}
QUINTILES = ["Lowest twenty per cent", "Second quintile group", "Third quintile group", "Fourth quintile group", "Highest twenty per cent"]
DECILES = ["Lowest ten per cent", *(f"{w} decile group" for w in ["Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth"]), "Highest ten per cent"]


def fetch() -> dict[str, Path]:
    paths = {}
    for sid, (dataset, file, _) in WORKBOOKS.items():
        url = f"https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/datasets/{dataset}/{EDITION}/{file}"
        paths[sid] = download(SOURCE_ID, url, f"{EDITION}_{file}").path
    return paths


def col_index(letter: str) -> int:
    return openpyxl.utils.column_index_from_string(letter) - 1


class Table:
    """One ONS table: rows keyed by the code in column A, header text by column."""

    def __init__(self, wb, name: str):
        self.name = name
        self.rows = [list(r) for r in wb[name].iter_rows(values_only=True)]
        title = " ".join(str(c) for r in self.rows[1:4] for c in r[:1] if c and not str(c).startswith("UK,"))
        self.title = re.sub(r"[¹²³⁴⁵⁶⁷⁸⁹⁰]", "", title).strip()  # footnote marks
        self.years = next(str(r[0]) for r in self.rows[1:5] if r[0] and str(r[0]).startswith("UK,")).removeprefix("UK, ")

    def row(self, code: str) -> list:
        """The row whose code is `code`: groups ("7") sit in column A, subgroups ("7.2.2") in B or C."""
        for i in (0, 1, 2):
            for r in self.rows:
                if len(r) > i and str(r[i] or "").strip() == code:
                    return r
        raise ValueError(f"{self.name}: no row {code}")

    def labelled(self, prefix: str) -> list:
        for r in self.rows:
            if str(r[0] or "").startswith(prefix):
                return r
        raise ValueError(f"{self.name}: no row starting {prefix!r}")

    def header(self, col: int) -> str:
        """The header cells above the first data row, for this column and the group label to its left."""
        out = []
        for r in self.rows[4:12]:
            own = r[col] if col < len(r) else None
            if own:
                out.append(str(own).strip())
            else:
                left = next((r[c] for c in range(col - 1, 3, -1) if c < len(r) and r[c]), None)
                if left:
                    out.append(str(left).strip())
        return " ".join(out)

    def columns(self, labels: list[str]) -> dict[str, int]:
        """Quintile or decile columns: the first data column (E) onwards, then All households."""
        cols = {**{label: 4 + i for i, label in enumerate(labels)}, "All households": 4 + len(labels)}
        for label, col in cols.items():
            if label.split()[0] not in self.header(col):
                raise ValueError(f"{self.name}: column {col + 1} header {self.header(col)!r} is not {label!r}")
        return cols


def cell(raw) -> float | str:
    """A published value: a number, or ONS's symbol (".." suppressed, ":" none recorded)."""
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw or "").strip().replace(",", "")
    if s in ("..", ":"):
        return s
    m = re.fullmatch(r"\[?(-?\d+(\.\d+)?)\]?", s)
    if not m:
        raise ValueError(f"unreadable cell {raw!r}")
    return float(m.group(1))


def boundaries(t: Table, label: str) -> list[float]:
    """Lower boundaries of the income groups after the first (£ a week)."""
    return [float(cell(v)) for v in t.labelled(label)[5:] if v not in (None, "")]


def group_of(weekly: float, lower: list[float]) -> int:
    """0-based income group for a weekly income, given the lower boundaries of groups 2 to n."""
    return sum(1 for b in lower if weekly >= b)


def pennies(v: float) -> float:
    return round(v + 1e-9, 2)


def build(paths: dict[str, Path]) -> dict:
    wbs = {sid: openpyxl.load_workbook(p, read_only=True, data_only=True) for sid, p in paths.items()}
    tables = {
        "A1": (Table(wbs["ons_fs_wb1"], "A1"), "ons_fs_wb1"),
        "A6": (Table(wbs["ons_fs_wb1"], "A6"), "ons_fs_wb1"),
        "A23": (Table(wbs["ons_fs_wb2"], "A23"), "ons_fs_wb2"),
        "A26": (Table(wbs["ons_fs_wb2"], "A26"), "ons_fs_wb2"),
        "A56": (Table(wbs["ons_fs_wb4"], "A56"), "ons_fs_wb4"),
    }
    a1, a6, a26 = tables["A1"][0], tables["A6"][0], tables["A26"][0]

    # Motor fuel: A6 by gross income decile; A1's petrol and diesel split (column G: average weekly £, all households).
    deciles = a6.columns(DECILES)
    decile_lower = boundaries(a6, "Lower boundary")
    fuel_by_decile = {
        str(i + 1): {"fuel": cell(a6.row("7.2.2")[deciles[d]]), "transport": cell(a6.row("7")[deciles[d]])} for i, d in enumerate(DECILES)
    }
    if "Average weekly" not in a1.header(6):
        raise ValueError(f"A1: column G header {a1.header(6)!r} is not the all-household weekly average")
    petrol, diesel = cell(a1.row("7.2.2.1")[6]), cell(a1.row("7.2.2.2")[6])
    petrol_share = petrol / (petrol + diesel)

    quintiles = a26.columns(QUINTILES)
    quintile_lower = boundaries(a26, "Lower boundary")

    archetypes = {}
    for aid, spec in ROWS.items():
        yearly, income_note = INCOME[aid]
        weekly_income = pennies(yearly / 52)
        t, sid = tables[spec["table"]]
        if spec.get("by_income"):
            q = group_of(weekly_income, quintile_lower)
            column_label = QUINTILES[q]
            col = quintiles[column_label]
        else:
            column_label = spec["column"]
            letter, expect = A23_COLUMNS[column_label]
            col = col_index(letter)
            head = t.header(col)
            if not all(e in head for e in expect):
                raise ValueError(f"{t.name} column {letter}: header {head!r} is not {column_label!r}")
        total = cell(t.row("1-12")[col])
        published = {code: cell(t.row(code)[col]) for code in GROUPS}
        weekly: dict[str, dict] = {}
        suppressed = [c for c, v in published.items() if v == ".."]
        for code, v in published.items():
            if v == ":":
                weekly[GROUPS[code]] = {"gbp": 0.0, "quality": "sourced", "note": "ONS ':' (no household in the row recorded any)."}
            elif v != "..":
                weekly[GROUPS[code]] = {"gbp": v, "quality": "sourced"}
        if suppressed:
            residual = pennies(total - sum(w["gbp"] for w in weekly.values()))
            if residual < 0:
                raise ValueError(f"{aid}: groups exceed the 1-12 total")
            names = " and ".join(GROUPS[c].removesuffix("_consumption").replace("_", " ") for c in suppressed)
            if len(suppressed) == 1:
                shares = {suppressed[0]: residual}
                how = f"{names.capitalize()} is the row's 1-12 total less its other groups."
            else:
                st, _ = tables[spec["split"][0]]
                split_col = st.columns(QUINTILES)[spec["split"][1]]
                weights = {c: float(cell(st.row(c)[split_col])) for c in suppressed}
                shares, left = {}, residual
                for i, c in enumerate(suppressed):
                    shares[c] = left if i == len(suppressed) - 1 else pennies(residual * weights[c] / sum(weights.values()))
                    left = pennies(left - shares[c])
                ratio = " : ".join(f"{weights[c]:.2f}" for c in suppressed)
                how = f"{names.capitalize()} together are the row's 1-12 total less its other groups (£{residual:.2f}), split {ratio} as in {spec['split'][0]}, {spec['split'][1]}."
            for c in suppressed:
                weekly[GROUPS[c]] = {"gbp": shares[c], "quality": "approx", "note": f"ONS '..' (suppressed: fewer than 10 households). {how}"}
        weekly = {name: weekly[name] for name in GROUPS.values()}  # COICOP order

        d = group_of(weekly_income, decile_lower)
        share = fuel_by_decile[str(d + 1)]["fuel"] / fuel_by_decile[str(d + 1)]["transport"]
        transport = weekly["transport_consumption"]["gbp"]
        fuel = pennies(transport * share)
        p = pennies(fuel * petrol_share)
        dd = fuel_by_decile[str(d + 1)]
        fuel_note = (
            f"Transport £{transport:.2f} × {share:.4f} (motor fuel's share of transport in gross income decile {d + 1}: "
            f"£{dd['fuel']:.2f} of £{dd['transport']:.2f}, A6) = £{fuel:.2f} a week, split {petrol_share:.2%} petrol and "
            f"{1 - petrol_share:.2%} diesel as all households split it (A1: £{petrol:.2f} and £{diesel:.2f})."
        )
        weekly["petrol_spending"] = {"gbp": p, "quality": "approx", "note": fuel_note}
        weekly["diesel_spending"] = {"gbp": pennies(fuel - p), "quality": "approx", "note": fuel_note}

        archetypes[aid] = {
            "row": {"source": sid, "table": t.name, "title": t.title, "column": column_label, "years": t.years},
            "gross_income_week": weekly_income,
            "income": income_note,
            "income_decile": d + 1,
            "total_1_12_week": total,
            "weekly": weekly,
        }

    for wb in wbs.values():
        wb.close()
    return {
        "meta": {
            "description": "Average weekly spending for each T1 example household (ARCHETYPES in packages/schema/src/t1.ts), from ONS Family spending in the UK. PolicyEngine UK charges VAT on the twelve COICOP groups and fuel duty on petrol and diesel, so these inputs let a VAT or fuel duty change reach the example households.",
            "built": date.today().isoformat(),
            "built_by": "python -m etl.archetype_spending",
            "edition": EDITION_TITLE,
            "published_on": PUBLISHED.isoformat(),
            "bulletin": BULLETIN,
            "sources": [
                {"id": sid, "title": title, "publisher": "Office for National Statistics", "url": f"{DATASETS}/{dataset}", "file": f"{EDITION}/{file}", "licence": "OGL v3"}
                for sid, (dataset, file, title) in WORKBOOKS.items()
            ],
            "units": "£ per household per week, as ONS publishes them (to 10p; derived values to 1p). PolicyEngine takes £ a year: weekly × 52.",
            "prices": "Cash prices of the table's years. Held fixed for every simulated year, like the archetypes' earnings.",
            "quality": "sourced: the published cell of the row chosen for the household. approx: derived where ONS publishes no such cell (the note says how).",
            "row_choice": "The ONS household composition closest to the archetype (A23). One adult not retired is also split by gross income quintile (A26), so the three singles use the quintile of their earnings. ONS publishes no income split for families with children or pensioners by composition, so their rows cover all incomes in that composition. A23 is one year (FYE 2025); A26 averages FYE 2023 to FYE 2025.",
            "income": "Gross weekly household income in 2025-26 (earnings plus benefits, PolicyEngine's current-law answers for the same households), used to pick income groups.",
            "symbols": {"..": "suppressed: fewer than 10 reporting households", ":": "no reporting households"},
            "variables": {**{v: f"COICOP {c}" for c, v in GROUPS.items()}, **{v: f"COICOP {c}" for c, v in FUEL.items()}},
        },
        "fuel": {
            "method": "Motor fuel (COICOP 7.2.2) is published by income, not household composition: motor fuel's share of transport (COICOP 7) in the archetype's gross income decile (A6), applied to the archetype's transport spending, then split into petrol and diesel as all households split it (A1).",
            "decile_lower_bounds_week": decile_lower,
            "by_decile_week": fuel_by_decile,
            "all_households_week": {"petrol": petrol, "diesel": diesel},
        },
        "archetypes": archetypes,
    }


def main() -> None:
    data = build(fetch())
    write_json(OUT, data)
    print(f"wrote {OUT.relative_to(ROOT)}")
    for aid, a in data["archetypes"].items():
        total = sum(v["gbp"] for k, v in a["weekly"].items() if k.endswith("_consumption"))
        fuel = a["weekly"]["petrol_spending"]["gbp"] + a["weekly"]["diesel_spending"]["gbp"]
        print(f"  {aid:20} {a['row']['table']} {a['row']['column']:58} 1-12 £{total:7.2f} (ONS £{a['total_1_12_week']:.2f})  fuel £{fuel:5.2f}  decile {a['income_decile']}")


if __name__ == "__main__":
    main()
