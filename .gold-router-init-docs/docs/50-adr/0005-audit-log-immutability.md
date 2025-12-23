# 0005: Audit log immutability

## Status
Proposed

## Context
Security-sensitive actions require tamper-evident records.

## Decision
Use an append-only audit log design with:
- event hashing chain (optional)
- restricted write access
- export with redaction

## Consequences
- Stronger post-incident forensics
- Additional storage/verification complexity
