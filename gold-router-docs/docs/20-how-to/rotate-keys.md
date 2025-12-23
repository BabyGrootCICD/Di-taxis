# How-to: Rotate keys

## Goal
Rotate exchange API keys and any local encryption keys safely.

## Steps
1. Revoke old API key at exchange
2. Create new key with least privilege
3. Update secret store
4. Verify connector health
5. Confirm audit log records rotation event

## Post-rotation checks
- No withdrawal permissions
- Rate limits unchanged
