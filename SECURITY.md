# Security Policy

## Supported Versions
This project is under active development. Security fixes are applied to the latest default branch.

## Reporting a Vulnerability
If you discover a security issue:
1. Do not open a public issue.
2. Email the maintainers with a clear reproduction, affected version/commit, impact assessment, and any mitigations.

## Security Requirements (high level)
- Secrets must never be committed.
- All connectors must enforce rate limiting and strict request signing.
- Sensitive data (API keys, PII) must be encrypted at rest and in transit.
- Audit logs must be tamper-evident (append-only design).
