# 0002: Exchange connector interface

## Status
Accepted

## Context
We need multiple exchange integrations while maintaining consistent risk controls and error handling.

## Decision
Define a canonical connector interface:
- health()
- getTicker(), getOrderBook()
- placeLimitOrder(), cancelOrder(), getOrderStatus()
- mapError()

## Consequences
- Faster addition of new venues
- Standardized observability and risk enforcement
