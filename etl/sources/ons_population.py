"""
ONS mid-year population estimates: UK usually resident population at 30 June.

One request per run: the CSV of time series UKPOP (dataset POP), which carries
every year from 1971 and the release date. The latest year is provisional and
is revised with the next edition (the build keeps the latest vintage).
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime

from etl.core import Observation, RawArtifact, Source, download

SOURCE = Source(
    id="ons_population",
    title="ONS Population estimates for the UK, England, Wales, Scotland and Northern Ireland (UKPOP)",
    publisher="ONS",
    url="https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/timeseries/ukpop/pop",
    licence="OGL v3",
    cadence_days=365,
    grace_days=90,
)

CSV_URL = (
    "https://www.ons.gov.uk/generator?format=csv&uri=/peoplepopulationandcommunity/"
    "populationandmigration/populationestimates/timeseries/ukpop/pop"
)
SERIES_ID = "people.population"


def fetch(since: date | None = None) -> list[RawArtifact]:
    raw = download(SOURCE.id, CSV_URL, "ukpop.csv")
    raw.vintage = vintage_for(read(raw.path)[0])
    return [raw]


def vintage_for(d: date) -> str:
    return f"MYE-{d:%Y-%m}"


def read(path) -> tuple[date, dict[int, float]]:
    """(release date, {year: persons}) from an ONS time-series CSV."""
    rows = list(csv.reader(io.StringIO(path.read_bytes().decode("utf-8-sig", errors="replace"))))
    meta = {r[0].strip().lower(): (r[1].strip() if len(r) > 1 else "") for r in rows if r and not re.fullmatch(r"\d{4}", r[0].strip())}
    if meta.get("cdid") != "UKPOP":
        raise ValueError(f"expected CDID UKPOP, got {meta.get('cdid')!r}")
    released = datetime.strptime(meta["release date"], "%d-%m-%Y").date()
    values = {int(r[0]): float(r[1]) for r in rows if len(r) > 1 and re.fullmatch(r"\d{4}", r[0].strip()) and r[1].strip()}
    if not values:
        raise ValueError("UKPOP CSV has no annual values")
    return released, values


def parse(raws: list[RawArtifact]) -> list[Observation]:
    raw = raws[0] if isinstance(raws, list) else raws
    released, values = read(raw.path)
    SOURCE.published_on = released
    vintage = raw.vintage or vintage_for(released)
    latest = max(values)
    out = []
    for year, persons in sorted(values.items()):
        note = f"UK usually resident population, mid-{year} (30 June); ONS CDID UKPOP, persons / 1,000,000."
        if year == latest:
            note += f" Latest edition (released {released:%d %B %Y}); provisional, revised next year."
        out.append(Observation(
            series_id=SERIES_ID, period=str(year), value=persons / 1e6, unit="persons_m", kind="outturn",
            source_id=SOURCE.id, vintage=vintage, quality="sourced", method_note=note,
        ))
    return out
