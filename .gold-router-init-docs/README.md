# Gold Router Fintech App

A non-custodial fintech application that routes gold-backed token exposure across multiple venues (CEX connectors + on-chain tracking) and provides a “resilience mode” playbook for continuity and emergency liquidity.

## What this repo contains
- `docs/` — product + architecture + security + operations documentation
- Optional MkDocs configuration (`mkdocs.yml`) for GitHub Pages publishing

## Principles
- **Non-custodial first**: users bring their own exchange API keys and wallets.
- **Defense-in-depth**: explicit risk controls for trading, withdrawals, and data.
- **Auditability**: structured ADRs and immutable audit logging design.

## Quick start (docs)
- Read: `docs/index.md`
- Product: `docs/00-product/prd.md`
- Architecture: `docs/40-explanations/architecture/c4-context.md`
- Security controls: `docs/30-reference/security/asvs-mapping.md`

## Disclaimer
This project and documentation are for educational and engineering design purposes only and do not constitute legal, financial, or investment advice.
