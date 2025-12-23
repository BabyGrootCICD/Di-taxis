# How-to: Implement a slippage guard

## Goal
Prevent trades from executing outside acceptable bounds.

## Steps
1. Define slippage policy (bps) per asset/venue
2. Require orderbook depth threshold
3. Enforce limit orders only (MVP)
4. Implement cancel-on-drift (optional)
5. Log every decision point

## Test cases
- Thin liquidity
- Rapid price moves
- Partial fills
