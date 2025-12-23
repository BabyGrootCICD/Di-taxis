# Gold Router App - Source Code Structure

This directory contains the source code for the Gold Router App, a non-custodial fintech application for gold-backed token trading.

## Directory Structure

```
src/
├── api/           # API Gateway and web interface components
├── connectors/    # Exchange and blockchain connectors
│   ├── exchanges/ # Exchange-specific implementations (Bitfinex, etc.)
│   └── trackers/  # Blockchain tracker implementations (Ethereum, etc.)
├── models/        # Core data models and interfaces
├── security/      # Security and cryptographic components
├── services/      # Business logic services
└── utils/         # Utility functions and helpers
```

## Core Components

### Models (`/models`)
- **Portfolio.ts**: Portfolio and venue holding data models
- **Order.ts**: Trading order and execution models
- **ConnectorStatus.ts**: Connector health and status models
- **AuditEvent.ts**: Audit logging and event models

### Services (`/services`)
- **PortfolioService**: Unified portfolio management across venues
- **TradingEngine**: Order routing and execution with risk controls
- **AuditService**: Tamper-evident audit logging
- **ResilienceManager**: Health checking and failover management

### Connectors (`/connectors`)
- **ExchangeConnector**: Base interface for exchange integrations
- **OnChainTracker**: Base interface for blockchain monitoring
- Exchange-specific implementations in `/exchanges`
- Blockchain tracker implementations in `/trackers`

### Security (`/security`)
- **SecurityManager**: Credential storage and cryptographic operations

### API (`/api`)
- **ApiGateway**: RESTful API endpoints and request handling

### Utils (`/utils`)
- **goldConversions.ts**: Gold token normalization utilities

## Testing

Property-based tests are located alongside their corresponding source files with `.test.ts` extension. The testing framework uses:
- **Vitest** for test execution
- **fast-check** for property-based testing
- Minimum 100 iterations per property test

## Development

- TypeScript configuration: `tsconfig.json`
- ESLint configuration: `.eslintrc.js`
- Vitest configuration: `vitest.config.ts`
- Package management: `package.json`