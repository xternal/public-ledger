"""
How published series become Statement lines. One place, so the mapping is reviewable.

Receipts come from one OBR table per year (EFO for the years it covers, the
databank before that) so the lines always sum to the total. Spending by
function comes from HMT PESA (COFOG); debt interest comes from OBR so it
matches the KPI; the reconciliation to OBR's TME is shown as its own line.
"""

RECEIPT_LINES = [
    # id, label, series
    ("income_tax", "Income tax", "receipts.income_tax"),
    ("nics", "National Insurance", "receipts.nics"),
    ("vat", "VAT", "receipts.vat"),
    ("corp_tax", "Corporation tax", "receipts.corp_tax"),
    ("council_tax", "Council tax", "receipts.council_tax"),
    ("business_rates", "Business rates", "receipts.business_rates"),
    ("fuel_duty", "Fuel duty", "receipts.fuel_duty"),
    ("stamp_duty", "Stamp duties", "receipts.stamp_duty"),
    ("cgt", "Capital gains tax", "receipts.cgt"),
    ("alcohol_tobacco", "Alcohol & tobacco", "receipts.alcohol_tobacco"),
    ("iht", "Inheritance tax", "receipts.iht"),
    ("other_taxes", "Other taxes", "receipts.other_taxes"),
    ("non_tax", "Non-tax income", "receipts.non_tax"),
]

# id, label, desc, COFOG series that make up the line (summed)
SPENDING_LINES = [
    ("social_protection", "Social protection", "Pensions, benefits, social care", ["spending.cofog.social_protection"]),
    ("health", "Health", "NHS and public health", ["spending.cofog.health"]),
    ("education", "Education", "Schools, colleges, universities", ["spending.cofog.education"]),
    ("economic_affairs", "Transport & economy", "Roads, rail, buses, business support, R&D", ["spending.cofog.economic_affairs"]),
    ("defence", "Defence", "Armed forces and equipment", ["spending.cofog.defence"]),
    ("public_order", "Police, courts, prisons", "Public order and safety", ["spending.cofog.public_order"]),
    (
        "general_services",
        "Running government",
        "Tax collection, councils' admin, international",
        ["spending.cofog.general_public_services", "-spending.cofog.general_public_services.debt_interest", "spending.cofog.eu_transactions"],
    ),
    ("housing_env", "Housing & environment", "Housing, local amenities, waste, flood defence", ["spending.cofog.housing_amenities", "spending.cofog.environment_protection"]),
    ("culture", "Culture & sport", "Museums, BBC grant-in-aid, sport, libraries", ["spending.cofog.recreation_culture"]),
]

DEBT_INTEREST = ("debt_interest", "Debt interest", "Interest on public debt, net of the Bank of England's asset purchases")
ACCOUNTING = (
    "accounting_adj",
    "Accounting adjustments",
    "Items in total spending that are not spending on services: public corporations, locally financed items and national-accounts adjustments",
)

# Above this share of TME, an unexplained reconciliation gap is shown as a balancing figure (plug).
PLUG_THRESHOLD_SHARE = 0.02
