# User Journeys

## Journey A: Routine allocation
1. Connect exchange API key (read + trade)
2. Set target allocation (grams-based view)
3. Execute rebalance with slippage guard
4. Verify on-chain transfers (if any)
5. Review audit trail

## Journey B: Resilience mode dry-run
1. Run “channel health check”
2. Simulate an exchange outage
3. Route execution to fallback venue
4. Export readiness summary (non-sensitive)

## Journey C: Incident response (user-facing)
1. Detect abnormal activity
2. Freeze trading actions (client-side policy)
3. Rotate keys / revoke access
4. Post-incident report
