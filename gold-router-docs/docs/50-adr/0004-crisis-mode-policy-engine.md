# 0004: Crisis mode policy engine

## Status
Proposed

## Context
Resilience mode needs deterministic safety defaults and quick toggles.

## Decision
Introduce a policy engine with:
- channel enable/disable flags
- dynamic confirmation thresholds
- max slippage tightening under volatility

## Consequences
- Clear operator controls
- Requires careful auditing of policy changes
