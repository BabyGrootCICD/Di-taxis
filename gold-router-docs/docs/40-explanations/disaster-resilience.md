# Disaster Resilience

## Goal
Enable continuity under partial failures (exchange outages, chain congestion).

## Resilience mode features (starter)
- Channel health check
- Playbook actions (disable venue, raise confirmation threshold)
- Export readiness report (redacted)

## Failure scenarios
- Exchange downtime
- Chain fee spike/congestion
- RPC provider outage
- Account lock or API key revocation

## Design principles
- Fallback routing
- Deterministic safety defaults
- Explicit user confirmation for risky operations
