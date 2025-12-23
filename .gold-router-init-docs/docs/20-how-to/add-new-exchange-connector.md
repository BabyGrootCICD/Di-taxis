# How-to: Add a new exchange connector

## Scope
Add a new exchange integration while preserving consistent risk controls.

## Steps
1. Implement connector interface
2. Add auth/signature logic
3. Add rate limiting + retries
4. Implement market data endpoints (ticker, orderbook)
5. Implement trading endpoints (place/cancel, order status)
6. Map errors to canonical error model
7. Add tests + sandbox verification
8. Update docs: `30-reference/connectors/exchanges/<name>.md`

## Done criteria
- Conforms to connector spec template
- Passes integration tests
- Threat model updated if required
