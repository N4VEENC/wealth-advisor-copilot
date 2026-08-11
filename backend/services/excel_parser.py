"""Parses an uploaded holdings Excel/CSV export into the normalized holdings
JSON shape used in backend/data/clients/{client-id}.json (see Backend Schema doc).

Each parsed row becomes a holding with a single-element `lots` list, since a
typical custodian export gives one blended quantity/cost-basis per position,
not per-lot detail (see services/holdings.py and recommendation_matcher.py,
which consume the same `lots` shape client records use everywhere else). If
the file happens to include a purchase-date column it's used; otherwise the
lot's purchase_date is null (documented: an unknown-age lot is treated
conservatively as short-term wherever tax-term classification happens, since
that's the higher-tax assumption).
"""
from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

VALID_ACCOUNT_TYPES = ("taxable", "401k", "ira", "roth_ira")

REQUIRED_FIELDS = ("ticker", "quantity", "cost_basis_per_share", "account_type")
OPTIONAL_FIELDS = ("purchase_date",)

_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "ticker": ("ticker", "symbol", "stock", "security"),
    "quantity": ("quantity", "qty", "shares", "share_count", "num_shares"),
    "cost_basis_per_share": (
        "cost_basis_per_share",
        "cost_basis",
        "cost_basis_share",
        "cost_per_share",
        "avg_cost",
        "average_cost",
        "basis",
    ),
    "account_type": ("account_type", "account", "account_name"),
    "purchase_date": ("purchase_date", "date_acquired", "acquired", "trade_date", "date_purchased"),
}

_ACCOUNT_TYPE_ALIASES: dict[str, str] = {
    "taxable": "taxable",
    "taxable brokerage": "taxable",
    "brokerage": "taxable",
    "individual": "taxable",
    "401k": "401k",
    "401 k": "401k",
    "ira": "ira",
    "traditional ira": "ira",
    "roth ira": "roth_ira",
    "roth": "roth_ira",
}


class HoldingsParseError(ValueError):
    """Raised when an uploaded holdings file is missing or has invalid required data."""


def _normalize_header(raw: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(raw).strip().lower()).strip("_")


def _normalize_account_key(raw: Any) -> str:
    key = re.sub(r"[^a-z0-9]+", " ", str(raw).strip().lower()).strip()
    return re.sub(r"\s+", " ", key)


def _resolve_columns(columns: list[Any]) -> dict[str, str]:
    """Map each required field name to the actual column label present in the file."""
    normalized_to_original = {_normalize_header(c): c for c in columns}
    resolved: dict[str, str] = {}
    for field, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized_to_original:
                resolved[field] = normalized_to_original[alias]
                break
    return resolved


def _normalize_account_type(raw: Any) -> str:
    key = _normalize_account_key(raw)
    if key in _ACCOUNT_TYPE_ALIASES:
        return _ACCOUNT_TYPE_ALIASES[key]
    compact = key.replace(" ", "")
    if compact in _ACCOUNT_TYPE_ALIASES:
        return _ACCOUNT_TYPE_ALIASES[compact]
    raise HoldingsParseError(
        f"Unrecognized account type '{raw}'. Expected one of "
        f"{', '.join(VALID_ACCOUNT_TYPES)} (or a common variant like "
        "'Taxable Brokerage', '401(k)', 'Roth IRA')."
    )


def _read_table(file: Any, filename: str | None) -> pd.DataFrame:
    if isinstance(file, (str, Path)):
        path = Path(file)
        filename = filename or path.name
        source: Any = path
    else:
        source = file
        filename = filename or getattr(file, "filename", None) or getattr(file, "name", None)

    if not filename:
        raise HoldingsParseError(
            "Could not determine the file type — pass a filename with a .csv or .xlsx/.xls extension."
        )

    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(source)
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(source)
    raise HoldingsParseError(f"Unsupported file type '{suffix}'. Upload a .csv or .xlsx/.xls file.")


def parse_holdings_file(file: Any, filename: str | None = None) -> list[dict[str, Any]]:
    """Parse an uploaded holdings Excel/CSV export into a normalized holdings list.

    `file` may be a path (str/Path) or a file-like/buffer object (e.g. FastAPI's
    `UploadFile.file`), in which case `filename` (or `file.filename`) is used to
    determine whether to parse it as CSV or Excel.

    Tolerates common column-name variants (e.g. "Symbol" vs "Ticker", "Qty" vs
    "Quantity") and common account-type spellings (e.g. "401(k)", "Roth IRA").
    Raises HoldingsParseError with a message naming any missing required
    columns, rather than failing silently.
    """
    df = _read_table(file, filename)

    if df.empty:
        raise HoldingsParseError("The uploaded file has no data rows.")

    resolved = _resolve_columns(list(df.columns))
    missing = [field for field in REQUIRED_FIELDS if field not in resolved]
    if missing:
        raise HoldingsParseError(
            "Missing required column(s): " + ", ".join(missing) + ". "
            "Found columns: " + ", ".join(str(c) for c in df.columns)
        )

    holdings: list[dict[str, Any]] = []
    for row_num, row in df.iterrows():
        line = row_num + 2  # +1 for header row, +1 for 0-index

        ticker = str(row[resolved["ticker"]]).strip().upper()
        if not ticker or ticker.lower() == "nan":
            raise HoldingsParseError(f"Row {line}: missing ticker.")

        try:
            quantity: float = float(row[resolved["quantity"]])
        except (TypeError, ValueError):
            raise HoldingsParseError(f"Row {line}: invalid quantity for {ticker}.")

        try:
            cost_basis_per_share = float(row[resolved["cost_basis_per_share"]])
        except (TypeError, ValueError):
            raise HoldingsParseError(f"Row {line}: invalid cost basis for {ticker}.")

        account_type = _normalize_account_type(row[resolved["account_type"]])

        quantity_normalized: float | int = int(quantity) if quantity == int(quantity) else quantity

        purchase_date = None
        if "purchase_date" in resolved:
            purchase_date = _parse_purchase_date(row[resolved["purchase_date"]])

        holdings.append(
            {
                "ticker": ticker,
                "account_type": account_type,
                "last_price": None,
                "last_price_updated_at": None,
                "lots": [
                    {
                        "quantity": quantity_normalized,
                        "cost_basis_per_share": round(cost_basis_per_share, 4),
                        "purchase_date": purchase_date,
                    }
                ],
            }
        )

    return holdings


def _parse_purchase_date(raw: Any) -> str | None:
    """Best-effort parse of a purchase-date cell to 'YYYY-MM-DD'. Returns
    None (unknown age) if the cell is blank or unparseable, rather than
    failing the whole upload over an optional column."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (datetime, date)):
        return raw.strftime("%Y-%m-%d")
    try:
        return pd.to_datetime(str(raw)).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None
