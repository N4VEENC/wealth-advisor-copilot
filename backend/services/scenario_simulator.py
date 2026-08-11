"""Deterministic scenario simulator.

Given a client's current holdings, cash balance, and live prices, projects
the impact of a market scenario on total portfolio value. Like optimizer.py,
this is pure arithmetic against documented, illustrative shock assumptions —
it is NOT a real forecast, statistical model, or Monte Carlo simulation. No
AI generates these numbers; wherever Gemini is involved (routers/scenarios.py
uses it only as a free-text CLASSIFIER — see gemini_client.classify_scenario
— to pick which of the archetypes below best matches a client's question),
it never invents a magnitude or adjusts a result computed here.

This is a library of recurring shock ARCHETYPES markets have historically
reacted to, not an attempt to enumerate every possible real-world event
(impossible for any fixed library) — the goal is breadth wide enough that
almost any real question, including future/unprecedented ones, maps to
something structurally similar to one of these.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from services import gemini_client, sector_classification
from services.holdings import total_quantity
from services.optimizer import classify_asset_class

logger = logging.getLogger(__name__)

# Only VXUS represents non-US equity exposure in this demo's known fund
# universe (see sector_classification.py) — currency scenarios shock a
# position only if it's actually internationally-exposed, so a client
# holding no VXUS correctly sees zero currency effect rather than a
# fabricated blanket one.
_INTERNATIONAL_TICKERS = frozenset({"VXUS"})

ShockFn = Callable[[dict[str, float]], dict[str, float]]


def _position_values(holdings: list[dict[str, Any]], prices: dict[str, float]) -> dict[str, float]:
    values: dict[str, float] = {}
    for holding in holdings:
        ticker = holding["ticker"]
        price = prices.get(ticker)
        if price is None:
            raise ValueError(f"No live price available for '{ticker}'; cannot simulate scenario.")
        values[ticker] = values.get(ticker, 0.0) + total_quantity(holding) * price
    return values


# --- Shock factories ---------------------------------------------------------
# Three reusable shapes cover every archetype below: a flat shock split only
# by equities-vs-fixed-income, a shock scoped to specific GICS-style sectors
# (applied to each position's fractional exposure to that sector via
# sector_classification.position_sector_breakdown — the same look-through
# logic the Sector exposure card uses, so a fund only has its exposed SLICE
# shocked, not its whole value), and a shock scoped to international vs.
# domestic exposure. Each archetype's own documented assumption (magnitude,
# direction, why) lives as a comment on its SCENARIOS entry below, not
# hidden inside these factories.


def _broad_shock(equities_pct: float, fixed_income_pct: float) -> ShockFn:
    def shock(position_values: dict[str, float]) -> dict[str, float]:
        return {
            ticker: value * (1 + (fixed_income_pct if classify_asset_class(ticker) == "fixed_income" else equities_pct))
            for ticker, value in position_values.items()
        }

    return shock


def _sector_shock(sector_pct: dict[str, float], other_equity_pct: float = 0.0, fixed_income_pct: float = 0.0) -> ShockFn:
    def shock(position_values: dict[str, float]) -> dict[str, float]:
        result: dict[str, float] = {}
        for ticker, value in position_values.items():
            if classify_asset_class(ticker) == "fixed_income":
                result[ticker] = value * (1 + fixed_income_pct)
                continue
            new_value = 0.0
            for sector, sector_value in sector_classification.position_sector_breakdown(ticker, value).items():
                new_value += sector_value * (1 + sector_pct.get(sector, other_equity_pct))
            result[ticker] = new_value
        return result

    return shock


def _international_shock(international_pct: float, domestic_pct: float = 0.0, fixed_income_pct: float = 0.0) -> ShockFn:
    def shock(position_values: dict[str, float]) -> dict[str, float]:
        result: dict[str, float] = {}
        for ticker, value in position_values.items():
            if classify_asset_class(ticker) == "fixed_income":
                pct = fixed_income_pct
            elif ticker.upper() in _INTERNATIONAL_TICKERS:
                pct = international_pct
            else:
                pct = domestic_pct
            result[ticker] = value * (1 + pct)
        return result

    return shock


# --- Scenario library ---------------------------------------------------------
# Every entry's "assumption" comment documents magnitude + direction + the
# real-world reasoning, the same rigor the original 3 presets used. None of
# these are calibrated forecasts — they're illustrative, named, auditable
# models, same spirit as projection.py's Monte Carlo return assumptions.

SCENARIOS: dict[str, dict[str, Any]] = {
    # --- Rate / monetary policy ---
    "rate_hike_100bps": {
        "label": "Rate hike +100bps",
        # Duration-based approximation: %price_change ~= -duration x
        # delta_yield, assuming ~5yr effective duration for a diversified
        # bond holding (a reasonable mid-duration aggregate-bond-fund
        # assumption) => +100bps implies ~-5% on fixed income. Equities
        # -1%: higher discount rates modestly pressure valuations, far less
        # directly than bonds.
        "shock_fn": _broad_shock(equities_pct=-0.01, fixed_income_pct=-0.05),
    },
    "rate_hike_200bps": {
        "label": "Rate hike +200bps",
        # Same duration model, doubled delta_yield: ~5yr duration x 2.00% =
        # -10% fixed income. Equities -3% (larger, non-linear pressure — a
        # 200bp move is more likely to also dent growth expectations, not
        # just discount rates).
        "shock_fn": _broad_shock(equities_pct=-0.03, fixed_income_pct=-0.10),
    },
    "rate_cut_easing": {
        "label": "Rate cut / easing cycle",
        # Mirror-image of a hike: ~5yr duration x -1.00% => +5% fixed
        # income (falling yields lift bond prices). Equities +3%: cheaper
        # financing and lower discount rates support valuations.
        "shock_fn": _broad_shock(equities_pct=0.03, fixed_income_pct=0.05),
    },
    "quantitative_tightening": {
        "label": "Quantitative tightening",
        # Central-bank balance-sheet runoff withdraws liquidity beyond a
        # simple rate move: fixed income -3% (less central-bank bond-buying
        # support, term premium rises), equities -4% (liquidity withdrawal
        # historically pressures risk assets more broadly than a rate hike
        # alone).
        "shock_fn": _broad_shock(equities_pct=-0.04, fixed_income_pct=-0.03),
    },
    "quantitative_easing": {
        "label": "Quantitative easing / stimulus",
        # Central-bank balance-sheet expansion / fiscal stimulus: equities
        # +8% (liquidity-driven rally, the mirror of QT), fixed income +3%
        # (direct central-bank bond purchases support prices).
        "shock_fn": _broad_shock(equities_pct=0.08, fixed_income_pct=0.03),
    },
    # --- Broad market / macro cycle ---
    "recession": {
        "label": "Recession",
        # Broad equities -25% (mid-severity recession drawdown, within the
        # documented ~20-30% range — not a worst-case crash). Fixed income
        # +2%: flight-to-safety / falling-rate expectations typical of
        # recessionary periods.
        "shock_fn": _broad_shock(equities_pct=-0.25, fixed_income_pct=0.02),
    },
    "correction": {
        "label": "Correction",
        # A milder, more common pullback than a recession or crash:
        # equities -10% (the textbook "correction" threshold), fixed income
        # +1% (mild flight to safety).
        "shock_fn": _broad_shock(equities_pct=-0.10, fixed_income_pct=0.01),
    },
    "crash": {
        "label": "Crash",
        # Severe, 2008/2020-style dislocation: equities -40% (well beyond a
        # recession's -25%), fixed income +3% (stronger flight-to-safety
        # than a milder downturn, though initial crash days can see
        # correlated selling before this plays out).
        "shock_fn": _broad_shock(equities_pct=-0.40, fixed_income_pct=0.03),
    },
    "flash_crash_shock": {
        "label": "Flash crash",
        # Distinct from "crash" above by DURATION/SHAPE, not just size: a
        # flash crash is a sharp, brief intraday-style dislocation that
        # PARTIALLY rebounds the same session/day, rather than the
        # sustained, days-to-weeks decline "crash" models. This simulator
        # only projects a single post-event state, not a time series, so
        # the documented rebound is baked directly into the net percentage
        # rather than shown as a separate before/after path: assume an
        # initial ~-20% air-pocket drop that recovers roughly half by the
        # time this is measured, netting equities -10%. Fixed income +1%
        # (a much smaller flight-to-safety than a sustained crash's +3% —
        # bonds don't have time to reprice much before the rebound).
        "shock_fn": _broad_shock(equities_pct=-0.10, fixed_income_pct=0.01),
    },
    "stagflation": {
        "label": "Stagflation",
        # Growth stalls AND inflation rises at once — the case where
        # equities and bonds fall together rather than bonds cushioning the
        # equity decline: equities -15% (margin compression, weak growth),
        # fixed income -8% (inflation erodes real bond value on top of
        # rate-hike expectations, worse than a simple rate-hike model).
        "shock_fn": _broad_shock(equities_pct=-0.15, fixed_income_pct=-0.08),
    },
    "expansion_bull_market": {
        "label": "Expansion / bull market",
        # Broad growth upcycle: equities +20%, fixed income -2% (growth
        # favors risk assets over safe havens; modest rate/growth pressure
        # on bonds).
        "shock_fn": _broad_shock(equities_pct=0.20, fixed_income_pct=-0.02),
    },
    "deflation": {
        "label": "Deflation",
        # Falling broad price levels: equities -12% (demand destruction and
        # falling corporate pricing power hurt earnings), fixed income +6%
        # (falling rates and safe-haven demand raise nominal bond prices —
        # deflation is one of the few regimes where bonds meaningfully
        # outperform).
        "shock_fn": _broad_shock(equities_pct=-0.12, fixed_income_pct=0.06),
    },
    "soft_landing": {
        "label": "Soft landing",
        # The "goldilocks" case: inflation cools without a recession.
        # Equities +6% (relief rally, growth intact), fixed income +1%
        # (modest support from cooling inflation expectations).
        "shock_fn": _broad_shock(equities_pct=0.06, fixed_income_pct=0.01),
    },
    # --- Sector-specific shocks ---
    "tech_selloff_25pct": {
        "label": "Tech selloff -25%",
        # -25% applied only to each position's Technology-sector exposure
        # (via look-through, so e.g. VOO's ~32%-Technology-weighted slice
        # is shocked, not its full value, and its other ~68% is
        # unaffected) — a sector-specific selloff shouldn't hit a
        # diversified 500-stock fund at full force. Other sectors/fixed
        # income unaffected (0%).
        "shock_fn": _sector_shock({"Technology": -0.25}),
    },
    "energy_shock": {
        "label": "Energy shock (oil spike)",
        # Oil-price spike: Energy-sector exposure +30% (direct beneficiary
        # — higher realized prices for producers), other equities -3%
        # (higher input/fuel costs modestly pressure the rest of the
        # market). Fixed income unaffected (0%).
        "shock_fn": _sector_shock({"Energy": 0.30}, other_equity_pct=-0.03),
    },
    "financials_banking_crisis": {
        "label": "Financials / banking crisis",
        # SVB-style stress: Financials-sector exposure -35% (direct hit),
        # other equities -8% (contagion/credit-availability fear spreads
        # broadly), fixed income +2% (flight to safety, simplified — this
        # model doesn't distinguish bank-issued from sovereign/agency
        # bonds).
        "shock_fn": _sector_shock({"Financials": -0.35}, other_equity_pct=-0.08, fixed_income_pct=0.02),
    },
    "healthcare_policy_shock": {
        "label": "Healthcare policy/regulation shock",
        # Drug-pricing or regulatory action: Healthcare-sector exposure
        # -15%, other sectors roughly flat (-1%) — a policy shock aimed at
        # one sector's pricing power/margins, not a broad macro event.
        "shock_fn": _sector_shock({"Healthcare": -0.15}, other_equity_pct=-0.01),
    },
    "real_estate_housing_downturn": {
        "label": "Real estate / housing downturn",
        # Real Estate-sector exposure -30% (direct hit), Financials -5%
        # (mortgage/lending exposure), other equities -3% (broader
        # wealth-effect drag). Fixed income unaffected (0%) — this model
        # doesn't separately model mortgage-backed securities.
        "shock_fn": _sector_shock({"Real Estate": -0.30, "Financials": -0.05}, other_equity_pct=-0.03),
    },
    "housing_crash_shock": {
        "label": "Housing crash",
        # A severe tier above the downturn: Real Estate -50% (well beyond
        # the downturn's -30%), Financials -15% (a 2008-style housing
        # crash stresses mortgage-lending balance sheets far more than an
        # ordinary downturn's -5%), other equities -8% (a sharper
        # wealth-effect/consumer-spending drag than -3%). Fixed income -3%
        # (unlike the plain downturn's 0% — at this severity, the same
        # documented simplification of not separately modeling
        # mortgage-backed securities means the whole fixed-income bucket
        # absorbs a small hit standing in for real MBS-adjacent credit
        # stress, since a crash of this size is systemic, not
        # real-estate-sector-contained).
        "shock_fn": _sector_shock(
            {"Real Estate": -0.50, "Financials": -0.15}, other_equity_pct=-0.08, fixed_income_pct=-0.03
        ),
    },
    "ai_boom_rally": {
        "label": "AI-boom rally",
        # Concentrated tech/semiconductor upside: Technology-sector
        # exposure +40%, Communication Services +15% (platform/ad
        # beneficiaries of the same theme), other equities +2% (broad
        # spillover optimism).
        "shock_fn": _sector_shock({"Technology": 0.40, "Communication Services": 0.15}, other_equity_pct=0.02),
    },
    "tech_regulation_crackdown": {
        "label": "Tech regulation crackdown",
        # Antitrust/regulatory action against large platforms:
        # Technology-sector exposure -18%, Communication Services -10%
        # (platform businesses named in the same actions), other equities
        # flat (0%) — a targeted regulatory shock, not a broad one.
        "shock_fn": _sector_shock({"Technology": -0.18, "Communication Services": -0.10}),
    },
    # --- Currency / inflation ---
    "dollar_strength_shock": {
        "label": "Dollar strength shock",
        # A stronger dollar shrinks foreign-currency assets when translated
        # to USD: international (VXUS) exposure -10%. Domestic equities
        # -2% (large-cap multinationals' foreign earnings also translate
        # to fewer dollars — a simplified net-negative, since this model
        # has no revenue-geography split to isolate purely domestic-revenue
        # names). Fixed income unaffected (0%).
        "shock_fn": _international_shock(international_pct=-0.10, domestic_pct=-0.02),
    },
    "dollar_weakness_shock": {
        "label": "Dollar weakness shock",
        # Mirror of dollar strength: international (VXUS) exposure +10%
        # (foreign-currency gains translate to more dollars), domestic
        # equities +2% (translated foreign earnings boost for
        # multinationals). Fixed income unaffected (0%).
        "shock_fn": _international_shock(international_pct=0.10, domestic_pct=0.02),
    },
    "dollar_collapse_shock": {
        "label": "Dollar collapse",
        # A severe tier above ordinary dollar weakness: international
        # (VXUS) exposure +25% (matching currency_crisis's -25% magnitude
        # mirrored the other direction — a genuinely severe, not just
        # moderate, currency move), domestic equities +5% (a larger
        # multinational-earnings translation boost than the moderate
        # tier's +2%). Fixed income unaffected (0%) — same simplification
        # as the moderate tier; this model has no direct
        # foreign-bond/currency-hedged fixed-income exposure to shock.
        "shock_fn": _international_shock(international_pct=0.25, domestic_pct=0.05),
    },
    "currency_crisis": {
        "label": "Currency crisis (EM-style)",
        # A sharper, EM-currency-crisis-style shock than ordinary dollar
        # strength: international exposure -25%. Documented approximation:
        # VXUS blends developed + emerging markets, so a crisis specific to
        # EM currencies is diluted across VXUS's whole (partly developed-
        # market) weight at this ticker granularity — a real EM-only fund
        # would see a sharper hit than this. Domestic equities -3%
        # (contagion/risk-off), fixed income +1% (flight to safety).
        "shock_fn": _international_shock(international_pct=-0.25, domestic_pct=-0.03, fixed_income_pct=0.01),
    },
    "inflation_spike": {
        "label": "Inflation spike",
        # Distinct from a rate hike: fixed income -12% (inflation erodes
        # the bond's REAL return directly — worse than the pure
        # discount-rate mechanics a rate-hike model captures). Equities
        # -5% (margin compression from rising input costs, more modest
        # than the bond impact).
        "shock_fn": _broad_shock(equities_pct=-0.05, fixed_income_pct=-0.12),
    },
    # --- Credit / liquidity ---
    "credit_crunch": {
        "label": "Credit crunch",
        # Lending/liquidity freezes broadly: fixed income -10% (credit
        # spreads blow out — this model doesn't distinguish corporate from
        # treasury/agency exposure within a broad aggregate-bond holding,
        # so the hit is applied to the whole fixed-income bucket).
        # Equities -18% (a liquidity freeze hits risk assets hard).
        "shock_fn": _broad_shock(equities_pct=-0.18, fixed_income_pct=-0.10),
    },
    "corporate_credit_spread_widening": {
        "label": "Corporate credit spread widening",
        # A narrower, less severe version of a credit crunch: fixed income
        # -6%, equities -8%. Same documented simplification as
        # credit_crunch — no corporate-vs-treasury split within the
        # fixed-income bucket.
        "shock_fn": _broad_shock(equities_pct=-0.08, fixed_income_pct=-0.06),
    },
    "sovereign_debt_crisis": {
        "label": "Sovereign debt crisis",
        # A government-debt-specific crisis: fixed income -15% (sovereign
        # bonds sell off directly — sharper than corporate spread
        # widening), equities -20% (broad risk-off contagion). Documented
        # simplification: this model doesn't isolate which country's debt
        # is in crisis or split sovereign from corporate bond exposure.
        "shock_fn": _broad_shock(equities_pct=-0.20, fixed_income_pct=-0.15),
    },
    # --- Commodity / geopolitical ---
    "oil_price_spike": {
        "label": "Oil price shock — spike",
        # Framed as the broader macro/commodity event (vs. energy_shock's
        # narrower sector framing): Energy-sector exposure +25%, other
        # equities -4% (a bigger, more inflationary commodity move than
        # energy_shock's -3%), fixed income -2% (rising inflation
        # expectations pressure bonds).
        "shock_fn": _sector_shock({"Energy": 0.25}, other_equity_pct=-0.04, fixed_income_pct=-0.02),
    },
    "oil_price_collapse": {
        "label": "Oil price shock — collapse",
        # Mirror of a spike: Energy-sector exposure -35% (direct hit to
        # producers), other equities +3% (cheaper input/fuel costs benefit
        # the rest of the market), fixed income +1% (disinflationary,
        # mildly supports bonds).
        "shock_fn": _sector_shock({"Energy": -0.35}, other_equity_pct=0.03, fixed_income_pct=0.01),
    },
    # War/geopolitical risk is deliberately split into two explicit named
    # severity tiers rather than one "moderate" catch-all — "war" covers an
    # enormous real-world range from a regional flare-up to something far
    # larger, and collapsing that range into a single illustrative number
    # was hiding a real severity choice the advisor should be able to pick
    # explicitly. Neither tier is a prediction of, or reference to, any
    # specific real conflict.
    "regional_conflict_shock": {
        "label": "Regional conflict (mild)",
        # A contained, regional flare-up: broad equities -8% (modest
        # risk-off, well short of a major shock), Energy +8% net
        # (supply-risk premium — smaller than the escalation tier's, since
        # a regional conflict poses a narrower supply threat), Industrials
        # +2% (a mild defense/aerospace demand uptick), fixed income +2%
        # (a brief, modest flight to bonds — not the sustained rush a
        # larger conflict would trigger).
        "shock_fn": _sector_shock({"Energy": 0.08, "Industrials": 0.02}, other_equity_pct=-0.08, fixed_income_pct=0.02),
    },
    "major_conflict_escalation_shock": {
        "label": "Major conflict escalation (severe)",
        # A severe tier above regional conflict: broad equities -25% (a
        # much larger risk-off move — approaching recession-level, +25%
        # deeper than the mild tier's -8pp equity impact vs its other
        # inputs), Energy +25% net (a much sharper supply-risk premium —
        # major escalations threaten broader energy-supply routes, not
        # just a contained region), Industrials +10% (a stronger
        # defense/aerospace demand move than the mild tier's +2%), fixed
        # income +8% (a much stronger, sustained flight to bonds than the
        # mild tier's brief +2%).
        "shock_fn": _sector_shock({"Energy": 0.25, "Industrials": 0.10}, other_equity_pct=-0.25, fixed_income_pct=0.08),
    },
    "trade_war_tariff": {
        "label": "Trade war / tariff shock",
        # Tariff escalation: broad equities -10% (margin/growth concern),
        # Industrials -15% extra (trade-exposed manufacturing/supply
        # chains hit hardest), Consumer Discretionary -12% extra (tariffs
        # raise import costs passed toward consumers), fixed income +2%
        # (growth-slowdown / rate-cut-expectation flight to safety).
        "shock_fn": _sector_shock(
            {"Industrials": -0.15, "Consumer Discretionary": -0.12}, other_equity_pct=-0.10, fixed_income_pct=0.02
        ),
    },
    "commodity_supercycle": {
        "label": "Commodity supercycle",
        # A broad, sustained commodity price surge: Energy +20% and
        # Materials +20% (the two sectors most directly tied to commodity
        # prices), other equities +2% (inflationary but growth-supportive
        # in a supercycle), fixed income -4% (sustained inflation
        # expectations pressure bonds). This model holds no direct
        # commodity fund, so the effect is proxied entirely through
        # commodity-linked equity sectors.
        "shock_fn": _sector_shock({"Energy": 0.20, "Materials": 0.20}, other_equity_pct=0.02, fixed_income_pct=-0.04),
    },
    # --- Tail-risk / black swan ---
    "pandemic_shock": {
        "label": "Pandemic-style shock",
        # Broad, sector-differentiated shock: Consumer Discretionary -35%
        # (proxy for travel/hospitality/in-person retail — this model has
        # no dedicated travel sector, so Consumer Discretionary stands in
        # for it), other equities -15% (broad economic disruption),
        # Healthcare -5% and Technology -8% (both relatively resilient —
        # smaller declines than the broad -15%, not gains, reflecting
        # continued demand and remote-work/digital tailwinds respectively).
        # Fixed income +3% (flight to safety).
        "shock_fn": _sector_shock(
            {"Consumer Discretionary": -0.35, "Healthcare": -0.05, "Technology": -0.08},
            other_equity_pct=-0.15,
            fixed_income_pct=0.03,
        ),
    },
    "cyber_infrastructure_shock": {
        "label": "Major cyber/infrastructure disruption shock",
        # A major cyberattack or infrastructure failure: Technology-sector
        # exposure -20% (direct hit to the sector most associated with the
        # disruption and its remediation costs), other equities -8%
        # (broader economic disruption from critical-system outages),
        # fixed income +2% (flight to safety).
        "shock_fn": _sector_shock({"Technology": -0.20}, other_equity_pct=-0.08, fixed_income_pct=0.02),
    },
    "sovereign_default": {
        "label": "Sovereign default shock",
        # More severe and binary than a sovereign debt crisis (default
        # realized, not just spreads widening): fixed income -25% (direct
        # default losses on sovereign exposure), broad equities -22%
        # (severe risk-off contagion). Same documented simplification as
        # sovereign_debt_crisis — no per-country or corporate/sovereign
        # split within the fixed-income bucket.
        "shock_fn": _broad_shock(equities_pct=-0.22, fixed_income_pct=-0.25),
    },
    # --- Labor market / macro signals / systemic risk ---
    "labor_market_shock_layoffs": {
        "label": "Labor market shock / mass layoffs",
        # Mechanically distinct from tech_selloff_25pct even though it also
        # hits Technology: tech_selloff is VALUATION-driven (a repricing of
        # growth multiples with no real-economy cause modeled), while this
        # is EMPLOYMENT-driven — actual job losses reduce real consumer
        # spending, which is why Consumer Discretionary (spending-sensitive
        # retail/travel/leisure names) takes the LARGEST hit here, not
        # Technology. Technology -12% (the layoffs are concentrated there),
        # Consumer Discretionary -15% (reduced spending from laid-off
        # workers — the actual transmission mechanism this archetype is
        # modeling), other equities -5% (broader growth concern), fixed
        # income +5% (a real labor-market shock is the kind of
        # deterioration that raises fed-easing/rate-cut expectations —
        # distinct from tech_selloff, which has zero fixed-income effect
        # since a pure valuation repricing carries no such signal).
        "shock_fn": _sector_shock(
            {"Technology": -0.12, "Consumer Discretionary": -0.15}, other_equity_pct=-0.05, fixed_income_pct=0.05
        ),
    },
    "yield_curve_inversion_signal_shock": {
        "label": "Yield curve inversion signal",
        # Documented as a "leading indicator" style shock, not a
        # crash-level move — an inversion is a signal markets react to
        # ahead of any confirmed downturn, not a downturn itself. Broad
        # equities -4% (modest), Financials -10% EXTRA on top of that
        # (margin compression — a flatter/inverted curve directly
        # compresses the spread banks lend on, so Financials is
        # specifically pressured beyond the broad market). Fixed income
        # left at 0%: this simulator only models a parallel shift in
        # yields (see rate_hike_100bps), not curve SHAPE, so it has no
        # mechanism to represent an inversion's actual bond-pricing
        # effect — a documented limitation rather than an invented number.
        "shock_fn": _sector_shock({"Financials": -0.14}, other_equity_pct=-0.04),
    },
    "liquidity_crisis_bank_contagion_shock": {
        "label": "Liquidity crisis / bank contagion",
        # Mechanically distinct from financials_banking_crisis: that
        # archetype models a bank-specific stress event where investors
        # flee TO bonds (+2% fixed income, a "normal" panic). This models
        # the broader, scarier case — a genuine cross-market liquidity
        # freeze where credit access seizes up everywhere, so even bond/
        # credit markets don't rally: fixed income -8% (credit freezes,
        # doesn't get a flight-to-safety bid — the key mechanical
        # difference from the banking-crisis archetype). Financials -30%
        # (hit hardest, still the epicenter), other equities -10% (a
        # modest-but-genuinely-broad dip across every sector, not
        # concentrated the way a single-sector shock would be).
        "shock_fn": _sector_shock({"Financials": -0.30}, other_equity_pct=-0.10, fixed_income_pct=-0.08),
    },
    "asset_bubble_burst_shock": {
        "label": "Asset bubble burst",
        # Distinct from tech_selloff_25pct's single-sector framing: a
        # genuine speculative-asset bubble unwind doesn't stay contained to
        # Technology, it hits every richly-valued, high-growth-multiple
        # sector this model's own sector_classification can identify —
        # Technology -30%, Communication Services -25%, Consumer
        # Discretionary -20% (the three sectors this app's fund
        # look-through data associates most with high-multiple growth
        # names), other equities -5% (broad spillover/risk-off), fixed
        # income +2% (mild flight to safety).
        "shock_fn": _sector_shock(
            {"Technology": -0.30, "Communication Services": -0.25, "Consumer Discretionary": -0.20},
            other_equity_pct=-0.05,
            fixed_income_pct=0.02,
        ),
    },
    "government_shutdown_fiscal_standoff_shock": {
        "label": "Government shutdown / fiscal standoff",
        # Documented as a low-severity, high-frequency-type event — this
        # kind of standoff recurs periodically and markets have
        # historically treated it as noise, not a real macro shock.
        # Broad equities -3% (modest, short-duration-style dip),
        # fixed income +1% (a small, brief flight to safety). No sector
        # differentiation — a fiscal/political standoff doesn't
        # mechanically target one sector over another the way a policy or
        # regulatory shock does.
        "shock_fn": _broad_shock(equities_pct=-0.03, fixed_income_pct=0.01),
    },
    "election_political_uncertainty_shock": {
        "label": "Election / political uncertainty",
        # Documented as UNCERTAINTY-driven rather than fundamentals-driven
        # — markets pricing in volatility ahead of an unresolved outcome,
        # not a reaction to any actual policy change. Broad equities -5%
        # (a modest, volatility-style dip — larger than the shutdown
        # archetype's -3% since a contested/uncertain election typically
        # unsettles markets more than a routine fiscal standoff), fixed
        # income +1% (mild flight to safety). No sector bias — this
        # archetype models pre-outcome uncertainty itself, not any
        # specific policy this model would have no basis to predict.
        "shock_fn": _broad_shock(equities_pct=-0.05, fixed_income_pct=0.01),
    },
}

# --- Free-text routing (non-AI baseline) --------------------------------------
# Basic keyword matching, NOT true NLP interpretation — a deterministic
# fallback for when the free-text scenario box is used directly against this
# module (e.g. tests, or if Gemini is unavailable). The real free-text
# understanding path is routers/scenarios.py calling
# gemini_client.classify_scenario, which selects one of this module's own
# SCENARIOS ids (or "no_match") — it never invents a magnitude, and this
# module has no AI dependency of its own.
#
# Ordering matters: this is checked top-to-bottom and the first substring hit
# wins, so every compound, multi-word phrase below is listed BEFORE any
# single bare word that could also appear inside it — e.g. "trade war" is
# checked before bare "war", and "dollar crashes"/"housing crash" are
# checked before bare "crash", so a phrase like "trade war with China" or
# "what if the dollar crashes" resolves to the specific scenario it actually
# describes rather than a generic one that merely shares a substring.
# Dangerously generic bare words that are substrings of many unrelated
# phrases (bare "crash", bare "war", bare "downturn") are deliberately left
# OUT entirely — better to fall through to Gemini classification on an
# ambiguous phrase than to confidently mis-route it here.
_KEYWORD_ROUTES: list[tuple[str, tuple[str, ...]]] = [
    ("rate_hike_200bps", ("200bps", "200 bps", "two hundred basis", "big rate hike", "large rate hike")),
    ("rate_hike_100bps", ("rate hike", "rates go up", "raise rates", "interest rate", "rate increase", "fed hike")),
    ("rate_cut_easing", ("rate cut", "rates go down", "lower rates", "easing cycle", "fed cut")),
    ("quantitative_tightening", ("quantitative tightening", "balance sheet runoff")),
    ("quantitative_easing", ("quantitative easing", "stimulus")),
    # "housing crash" is the severe tier's own name — checked before the
    # milder downturn's remaining, less-severe-sounding phrases.
    ("housing_crash_shock", ("housing crash", "housing market crash", "housing bubble bursts", "real estate collapse")),
    ("real_estate_housing_downturn", ("housing downturn", "real estate crash", "property downturn")),
    ("dollar_strength_shock", ("dollar strength", "dollar surges", "dollar rallies", "strong dollar")),
    # "dollar collapse" checked before the moderate tier's own keywords so
    # a severe phrase never falls back to the milder shock.
    ("dollar_collapse_shock", ("dollar collapse", "dollar collapses", "currency collapse", "dollar implodes")),
    ("dollar_weakness_shock", ("dollar weakness", "dollar crashes", "dollar falls", "weak dollar")),
    ("currency_crisis", ("currency crisis", "emerging market crisis", "em crisis")),
    ("trade_war_tariff", ("trade war", "tariff", "tariffs")),
    ("financials_banking_crisis", ("banking crisis", "bank crisis", "bank run", "svb", "financial crisis")),
    ("healthcare_policy_shock", ("healthcare policy", "drug pricing", "healthcare regulation")),
    ("tech_regulation_crackdown", ("tech regulation", "antitrust", "regulatory crackdown")),
    ("tech_selloff_25pct", ("tech selloff", "tech sell-off", "tech crash", "technology stocks", "tech stocks", "nasdaq")),
    ("ai_boom_rally", ("ai boom", "ai rally", "artificial intelligence rally")),
    ("oil_price_spike", ("oil price spike", "oil prices spike", "oil surge")),
    ("oil_price_collapse", ("oil collapse", "oil crash", "oil price collapse", "oil prices collapse")),
    ("energy_shock", ("energy shock", "oil spike")),
    ("commodity_supercycle", ("commodity supercycle", "commodity boom", "commodity surge")),
    ("credit_crunch", ("credit crunch", "credit freeze")),
    ("corporate_credit_spread_widening", ("credit spread", "spread widening")),
    ("sovereign_default", ("sovereign default", "government default", "default on debt")),
    ("sovereign_debt_crisis", ("sovereign debt", "debt crisis")),
    ("cyber_infrastructure_shock", ("cyberattack", "cyber attack", "infrastructure disruption", "power grid")),
    ("pandemic_shock", ("pandemic", "epidemic", "outbreak")),
    # Escalation-specific phrases checked before the regional/mild tier's
    # more generic ones, so "major war breaks out" doesn't fall back to the
    # mild archetype just because it also contains "war".
    (
        "major_conflict_escalation_shock",
        ("major war", "war breaks out", "full-scale war", "major conflict", "war escalates", "escalation"),
    ),
    ("regional_conflict_shock", ("geopolitical", "regional conflict", "military conflict", "armed conflict", "invasion", "war risk")),
    ("stagflation", ("stagflation",)),
    ("deflation", ("deflation", "falling prices")),
    ("soft_landing", ("soft landing",)),
    ("expansion_bull_market", ("bull market", "expansion", "economic boom")),
    ("inflation_spike", ("inflation spike", "inflation surges", "high inflation")),
    ("correction", ("correction", "pullback")),
    ("recession", ("recession", "economic slowdown")),
    # New archetypes/tiers below are checked before the generic "crash"
    # catch-all so a more specific phrase (e.g. "flash crash",
    # "speculative stocks crash") never falls back to the plain sustained
    # crash just because it also contains "crash".
    ("flash_crash_shock", ("flash crash", "sudden crash", "brief crash")),
    ("labor_market_shock_layoffs", ("layoffs", "mass layoffs", "job losses", "labor market shock", "unemployment spike")),
    ("yield_curve_inversion_signal_shock", ("yield curve invert", "yield curve inversion", "inverted yield curve", "curve inversion")),
    (
        "liquidity_crisis_bank_contagion_shock",
        ("liquidity crisis", "banks freeze lending", "interbank lending freeze", "bank contagion", "credit freeze between banks"),
    ),
    ("asset_bubble_burst_shock", ("asset bubble", "bubble bursts", "speculative bubble", "speculative stocks crash", "meme stock crash")),
    (
        "government_shutdown_fiscal_standoff_shock",
        ("government shutdown", "government shuts down", "fiscal standoff", "debt ceiling standoff", "budget impasse"),
    ),
    ("election_political_uncertainty_shock", ("election uncertainty", "political uncertainty", "election volatility", "contested election")),
    ("crash", ("2008", "black monday", "market collapse", "stock market crash", "market crash")),
]


class UnrecognizedScenarioError(ValueError):
    """Raised when a scenario identifier or free-text input can't be resolved
    to one of the known preset shock models."""


def resolve_scenario_with_ai_fallback(scenario_input: str) -> str:
    """Resolve free text to a known scenario id, trying the deterministic
    path first (resolve_scenario_id: exact id/label match, then keyword
    routing) and only calling Gemini/Groq as a pure classifier if that
    genuinely can't match. Shared by routers/scenarios.py (the Scenario
    Analysis card) and services/chat_service.py (the AI Chat panel's
    run_scenario tool) so both entry points use the exact same resolution
    order rather than each re-implementing it. Raises
    UnrecognizedScenarioError if nothing matches even with AI help."""
    try:
        return resolve_scenario_id(scenario_input)
    except UnrecognizedScenarioError:
        pass

    known_scenarios = [{"id": sid, "label": cfg["label"]} for sid, cfg in SCENARIOS.items()]
    try:
        classified_id = gemini_client.classify_scenario(scenario_input, known_scenarios)
    except gemini_client.GeminiError as exc:
        logger.warning("Gemini scenario classification unavailable for '%s': %s", scenario_input, exc)
        classified_id = None

    # Defensive: only trust a classified id if it's actually one of the
    # real, known scenarios — an LLM can still hallucinate a plausible-
    # looking id outside the given list despite being told not to.
    if classified_id is not None and classified_id in SCENARIOS:
        logger.info("Gemini classified free-text scenario '%s' as '%s'.", scenario_input, classified_id)
        return classified_id

    raise UnrecognizedScenarioError(
        f"Could not match scenario '{scenario_input}' to any known preset — tried exact match, "
        "keyword routing, and Gemini classification."
    )


def resolve_scenario_id(scenario_input: str) -> str:
    """Resolve a scenario identifier, display label, or free-text string to a
    known scenario id.

    Tries an exact id/label match first (case-insensitive), then falls back
    to simple substring keyword matching against _KEYWORD_ROUTES (checked in
    the order above, so more specific phrases like "200bps" are tried before
    the more general "rate hike"). Raises UnrecognizedScenarioError if
    nothing matches either way — the caller (routers/scenarios.py) tries
    Gemini classification before giving up entirely.
    """
    normalized = scenario_input.strip().lower()

    for scenario_id, config in SCENARIOS.items():
        if normalized == scenario_id.lower() or normalized == config["label"].lower():
            return scenario_id

    for scenario_id, keywords in _KEYWORD_ROUTES:
        if any(keyword in normalized for keyword in keywords):
            return scenario_id

    raise UnrecognizedScenarioError(
        f"Could not match scenario '{scenario_input}' to a known preset via exact match or keyword routing."
    )


def simulate_scenario(
    scenario_input: str,
    holdings: list[dict[str, Any]],
    cash_balance: float,
    prices: dict[str, float],
) -> dict[str, Any]:
    """Project the impact of a scenario on a client's portfolio.

    `scenario_input` must already be a resolved scenario id (e.g.
    "recession") — routers/scenarios.py resolves free text to an id (via
    resolve_scenario_id's keyword fallback, or gemini_client.classify_scenario)
    before calling this. Raises UnrecognizedScenarioError if `scenario_input`
    isn't a known id, or ValueError if a holding's ticker has no matching
    live price.
    """
    if scenario_input not in SCENARIOS:
        # Still accept a label or free text here too, so this function
        # keeps working standalone (e.g. in tests) without requiring the
        # caller to always pre-resolve.
        scenario_id = resolve_scenario_id(scenario_input)
    else:
        scenario_id = scenario_input
    config = SCENARIOS[scenario_id]

    before_positions = _position_values(holdings, prices)
    after_positions: dict[str, float] = config["shock_fn"](before_positions)

    def _bucket_totals(position_totals: dict[str, float]) -> dict[str, float]:
        equities = sum(v for t, v in position_totals.items() if classify_asset_class(t) == "equities")
        fixed_income = sum(v for t, v in position_totals.items() if classify_asset_class(t) == "fixed_income")
        return {"equities": equities, "fixed_income": fixed_income, "cash": cash_balance}

    before_buckets = _bucket_totals(before_positions)
    after_buckets = _bucket_totals(after_positions)  # cash carries through unshocked in every scenario

    before_total = sum(before_buckets.values())
    after_total = sum(after_buckets.values())

    if before_total <= 0:
        raise ValueError("Portfolio total value is zero; cannot simulate scenario.")

    return {
        "scenario_id": scenario_id,
        "scenario_label": config["label"],
        "matched_input": scenario_input,
        "projected_total_value": round(after_total, 2),
        "dollar_change": round(after_total - before_total, 2),
        "percent_change": round((after_total - before_total) / before_total, 4),
        "breakdown": {
            bucket: {
                "before": round(before_buckets[bucket], 2),
                "after": round(after_buckets[bucket], 2),
            }
            for bucket in ("equities", "fixed_income", "cash")
        },
    }
