# Errors (Canonical Model)

## Error envelope
- `code`: stable machine-readable code
- `message`: human-readable explanation
- `request_id`: correlation id

## Error categories
- AUTH: authentication / signature errors
- PERM: permission/least-privilege violations
- RATE: rate limit exceeded
- EXCH: exchange upstream failure
- CHAIN: chain/indexer failure
- RISK: risk control prevented execution
- VALID: request validation failure

## Retriable vs non-retriable
- Retriable:
- Non-retriable:
