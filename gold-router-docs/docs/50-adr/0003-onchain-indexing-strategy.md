# 0003: On-chain indexing strategy

## Status
Accepted

## Context
On-chain reads must be reliable despite RPC outages and inconsistent indexers.

## Decision
Use a dual approach:
- Primary indexer/RPC provider
- Secondary fallback provider
- Reconcile differences using confirmation policy

## Consequences
- Higher reliability
- Slightly higher complexity and cost
