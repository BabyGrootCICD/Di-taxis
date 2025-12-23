# Withdrawal Controls

## Objectives
- Reduce the risk of unauthorized withdrawals
- Minimize blast radius of compromised credentials

## Controls (recommended)
- No-withdraw permissions for exchange API keys (default)
- Address allowlist for any wallet transfers
- Delayed withdrawal (time-lock) if implemented
- Optional multi-party approval (Phase 3+)

## Monitoring
- Alerts for new address additions
- Alerts for withdrawal attempts
- Daily summary reconciliation

## Incident response link
- See: `docs/60-runbooks/incident-response.md`
