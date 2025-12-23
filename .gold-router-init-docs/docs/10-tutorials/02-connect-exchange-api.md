# Tutorial: Connect an exchange API (non-custodial)

## Goal
Connect a user-owned API key to an exchange connector with least privilege.

## Prerequisites
- Exchange account
- API key created with minimal permissions

## Steps
1. Create an API key (trade-only, no withdrawals)
2. Store key securely (local secret store)
3. Verify connectivity (health check)
4. Place a test order in sandbox / small size
5. Confirm audit logging

## Common pitfalls
- Incorrect permissions
- Clock skew affecting signatures
- Rate limits

## Next steps
- Add slippage guard: `20-how-to/implement-slippage-guard.md`
