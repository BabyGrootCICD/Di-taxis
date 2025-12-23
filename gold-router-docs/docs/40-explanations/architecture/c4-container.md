# C4: Container Diagram

## Purpose
Show deployable units and their interactions.

## Containers (starter)
- Web UI
- API service
- Connector workers
- Database (optional)
- Audit log store (append-only)

## Data flows
- UI → API
- API → connectors
- Connectors → exchanges/chains
- API → audit store

## Diagram (placeholder)
Add a container diagram under `docs/assets/diagrams/`.
