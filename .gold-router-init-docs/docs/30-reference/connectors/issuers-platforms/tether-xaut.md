# Issuer/Platform: Tether XAUt

## Overview
- Representation: XAUt exposure and redemption assumptions
- Supported chains (by product policy):
- Primary usage in this app: liquidity route via exchange connectors + on-chain tracking

## Data sources
- Exchange markets for trading
- On-chain balance/transfer tracking
- Optional issuer/indexer tooling (if used)

## Risk notes
- Counterparty risk:
- Redemption constraints:
- Chain-specific risks:

## Implementation notes
- Contract/mint addresses and chain parameters are environment-configured.
- Prefer read-only indexers where possible; validate results via multiple sources.

## Test checklist
- Trading path:
- Withdrawal/deposit path:
- On-chain reconciliation:
