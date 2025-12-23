# Trading Controls

## Objectives
- Prevent unexpected execution prices
- Avoid thin-liquidity fills
- Ensure deterministic behavior under partial outages

## Controls (MVP baseline)
- Limit orders only
- Max slippage (bps) per venue/asset
- Min depth threshold
- Circuit breaker on abnormal spread/volatility
- Retries with bounded backoff
- Cancel-on-timeout

## Configuration
- Policy parameters:
- Per-asset overrides:
- Per-venue overrides:

## Audit requirements
- Record: intent, quotes, selection rationale, order ids, fills, final outcome
