# Tutorial: Crisis mode dry-run

## Goal
Perform a resilience-mode dry run without moving real funds.

## Steps
1. Run channel health check
2. Simulate exchange outage (disable connector)
3. Verify routing to fallback venue
4. Simulate chain congestion (raise confirmation threshold)
5. Export readiness summary (no secrets)

## Success criteria
- User can execute playbook within a target time window
- Audit log records all actions
