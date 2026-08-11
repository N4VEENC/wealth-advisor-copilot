"""Monte Carlo current-vs-target allocation growth projection.

Replaces the earlier single-path blended-rate model with a real stochastic
simulation: for each simulated year, one random annual return per asset
class is drawn from a documented mean/volatility assumption, and BOTH the
current-allocation blend and the target-allocation blend are computed from
the SAME draw for that path/year. This is deliberate — it means the two
lines differ only because of the allocation *weights*, not because of two
unrelated streams of random noise, which is what makes "current path vs.
target path" a meaningful comparison rather than two independent random
walks.

This is illustrative modeling for a demo, not real financial forecasting:
- The mean/volatility figures below are rough, commonly-cited long-run
  textbook assumptions for a "moderate growth" outlook, not a calibrated
  capital-markets-assumptions model.
- Annual returns are drawn independently year-to-year (no autocorrelation,
  no fat tails/skew, no cross-asset correlation beyond sharing the same
  draw across the two allocation blends, no sequencing-of-returns nuance
  beyond simple annual compounding).
- No AI is involved anywhere in this file — same architecture rule as
  optimizer.py / scenario_simulator.py / recommendation_matcher.py: this is
  pure arithmetic (here, pure arithmetic over random draws), and Gemini's
  role (if this is ever narrated) would be to describe the output, never to
  generate or adjust it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import numpy as np

# Illustrative annual return assumptions per asset class: (mean, stdev).
# Rough, commonly-cited long-run figures — NOT a calibrated forecast.
ASSUMED_RETURN_DISTRIBUTION: dict[str, tuple[float, float]] = {
    "equities": (0.07, 0.16),
    "fixed_income": (0.03, 0.05),
    "cash": (0.01, 0.005),
}

# Documented: 10,000 paths balances statistical smoothness against
# per-request compute time — numpy vectorizes this so it's fast even at
# this size (well under a second for a ~13-year horizon).
DEFAULT_PATH_COUNT = 10_000


def _blended_path_returns(draws: dict[str, np.ndarray], allocation: dict[str, float]) -> np.ndarray:
    """`draws[asset_class]` has shape (paths, years). Returns the
    allocation-weighted blended return array, same shape."""
    blended = np.zeros_like(next(iter(draws.values())))
    for asset_class, weight in allocation.items():
        if asset_class in draws:
            blended = blended + weight * draws[asset_class]
    return blended


def _simulate_paths(
    starting_value: float, returns: np.ndarray, annual_contribution: float, path_count: int, n_years: int
) -> np.ndarray:
    """`returns` has shape (paths, years). Returns values with shape
    (paths, years+1); column 0 is today's value."""
    values = np.empty((path_count, n_years + 1))
    values[:, 0] = starting_value
    for year in range(n_years):
        values[:, year + 1] = values[:, year] * (1 + returns[:, year]) + annual_contribution
    return values


def resolve_goal_amount(client: dict[str, Any]) -> float | None:
    """The single source of truth for whether a client has a REAL,
    advisor-provided retirement goal dollar amount. Every caller of
    run_monte_carlo_projection (routers/portfolio.py's /projection endpoint,
    routers/reports.py's report generation, services/chat_service.py's
    get_projection tool and exploratory-context block) must resolve
    `goal_amount` through this function rather than reading
    `target_retirement_amount` off the client record itself — so a real
    value is never silently ignored, and none of those callers can drift
    out of sync on what counts as "set."
    """
    return client.get("target_retirement_amount")


def run_monte_carlo_projection(
    total_portfolio_value: float,
    current_allocation: dict[str, float],
    target_allocation: dict[str, float],
    annual_contribution: float,
    goal_year: int,
    goal_amount: float | None = None,
    path_count: int = DEFAULT_PATH_COUNT,
) -> dict[str, Any]:
    """Run the Monte Carlo simulation and return the median dual-line chart
    data, a probability-of-reaching-goal figure for both the current and
    target allocations, and each allocation's simulated annualized
    volatility (std dev of its blended return draws).

    `goal_amount` should be resolve_goal_amount(client)'s result — a REAL,
    advisor-provided dollar figure (client["target_retirement_amount"]) if
    the advisor has set one, or None. When None, this function falls back
    to the terminal value of a simple deterministic (non-stochastic)
    blended-rate projection at the target allocation — i.e., "probability
    of at least matching what a plain non-random model would have
    projected." The returned `goal_amount_source` tells every caller which
    case applied ("advisor_provided" vs. "estimated") so nothing downstream
    has to re-derive or guess it.
    """
    goal_amount_source = "advisor_provided" if goal_amount is not None else "estimated"
    current_year = datetime.now(timezone.utc).year
    n_years = max(goal_year - current_year, 0)

    if n_years == 0:
        chart_data = [
            {
                "year": current_year,
                "current_trajectory": round(total_portfolio_value, 2),
                "target_trajectory": round(total_portfolio_value, 2),
            }
        ]
        reached = 1.0 if total_portfolio_value >= (goal_amount or 0) else 0.0
        return {
            "path_count": path_count,
            "goal_year": current_year,
            "goal_amount": round(goal_amount or total_portfolio_value, 2),
            "goal_amount_source": goal_amount_source,
            "probability_of_reaching_goal": reached,
            "probability_of_reaching_goal_current": reached,
            "annualized_volatility_current": 0.0,
            "annualized_volatility_target": 0.0,
            "annual_contribution": annual_contribution,
            "projection_chart_data": chart_data,
        }

    rng = np.random.default_rng()
    draws = {
        asset_class: rng.normal(mean, stdev, size=(path_count, n_years))
        for asset_class, (mean, stdev) in ASSUMED_RETURN_DISTRIBUTION.items()
    }

    current_returns = _blended_path_returns(draws, current_allocation)
    target_returns = _blended_path_returns(draws, target_allocation)

    current_paths = _simulate_paths(total_portfolio_value, current_returns, annual_contribution, path_count, n_years)
    target_paths = _simulate_paths(total_portfolio_value, target_returns, annual_contribution, path_count, n_years)

    current_median = np.median(current_paths, axis=0)
    target_median = np.median(target_paths, axis=0)

    chart_data = [
        {
            "year": current_year + i,
            "current_trajectory": round(float(current_median[i]), 2),
            "target_trajectory": round(float(target_median[i]), 2),
        }
        for i in range(n_years + 1)
    ]

    if goal_amount is None:
        deterministic_target_rate = sum(
            target_allocation.get(asset_class, 0.0) * mean
            for asset_class, (mean, _stdev) in ASSUMED_RETURN_DISTRIBUTION.items()
        )
        deterministic_value = total_portfolio_value
        for _ in range(n_years):
            deterministic_value = deterministic_value * (1 + deterministic_target_rate) + annual_contribution
        goal_amount = deterministic_value

    success_count = int(np.sum(target_paths[:, -1] >= goal_amount))
    probability_of_reaching_goal = success_count / path_count
    success_count_current = int(np.sum(current_paths[:, -1] >= goal_amount))
    probability_of_reaching_goal_current = success_count_current / path_count

    # Annualized volatility of each allocation's simulated blended return —
    # a direct statistic of the same random draws used for the paths above
    # (std dev across every path/year draw), not a separately-fabricated
    # figure. This is what backs the projection card's "Volatility (ann.)"
    # before/after stat.
    annualized_volatility_current = float(np.std(current_returns))
    annualized_volatility_target = float(np.std(target_returns))

    return {
        "path_count": path_count,
        "goal_year": current_year + n_years,
        "goal_amount": round(goal_amount, 2),
        "goal_amount_source": goal_amount_source,
        "probability_of_reaching_goal": round(probability_of_reaching_goal, 4),
        "probability_of_reaching_goal_current": round(probability_of_reaching_goal_current, 4),
        "annualized_volatility_current": round(annualized_volatility_current, 4),
        "annualized_volatility_target": round(annualized_volatility_target, 4),
        "annual_contribution": annual_contribution,
        "projection_chart_data": chart_data,
    }
