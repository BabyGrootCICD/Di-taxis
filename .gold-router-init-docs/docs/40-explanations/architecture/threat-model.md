# Threat Model

## Scope
Non-custodial client + server components and third-party dependencies.

## Method
- STRIDE (recommended starter) or LINDDUN (privacy)

## Assets to protect
- Exchange API keys
- User identity and activity metadata
- Audit log integrity
- Routing/risk policy correctness

## Threats (starter list)
- Credential theft
- API replay/signature abuse
- Supply chain compromise
- Rogue RPC/indexer data
- UI injection / phishing

## Mitigations
- Least privilege keys
- Strong signing + nonce/ts validation
- Defense-in-depth in connectors
- Multi-source validation
- Tamper-evident audit logs
