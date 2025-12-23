# How-to: Implement the price router

## Goal
Choose execution venue(s) based on price, depth, fees, and reliability.

## Inputs
- Order intent (buy/sell, size, token)
- Venue quotes (price, depth)
- Risk controls (max slippage, min depth)
- Health checks (connector status)

## Steps
1. Normalize quotes across venues
2. Filter by health and risk policy
3. Score venues (price + fees + depth)
4. Choose primary + fallback
5. Execute with limit orders and monitoring
6. Write immutable audit entries

## Validation
- Simulate outages
- Verify slippage invariants
