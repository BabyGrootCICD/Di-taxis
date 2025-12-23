# Design Document

## Overview

The Gold Router App is a non-custodial fintech application designed to provide users with unified gold-backed token exposure across multiple trading venues while maintaining security, auditability, and resilience. The system architecture follows a modular design with clear separation between user interface, business logic, exchange connectors, on-chain tracking, and security controls.

The application operates on the principle of least privilege, where users maintain control of their API keys and assets while the system provides intelligent routing, risk management, and operational resilience capabilities. The design emphasizes defense-in-depth security, comprehensive audit logging, and graceful degradation during partial system outages.

## Architecture

The system follows a layered architecture with the following key components:

### Presentation Layer
- **Web UI**: Browser-based interface for portfolio management, trading, and system monitoring
- **API Gateway**: RESTful API providing programmatic access to all system functions

### Business Logic Layer  
- **Portfolio Service**: Aggregates and normalizes holdings across all venues
- **Trading Engine**: Handles order routing, execution, and risk controls
- **Resilience Manager**: Implements health checking and fallback routing logic
- **Audit Service**: Manages tamper-evident logging of all security-sensitive operations

### Integration Layer
- **Exchange Connectors**: Modular connectors for each supported centralized exchange
- **On-Chain Trackers**: Blockchain monitoring components for supported networks
- **Security Manager**: Handles credential storage, encryption, and access controls

### Data Layer
- **Configuration Store**: System and user configuration data
- **Audit Log Store**: Append-only storage for audit records
- **Cache Layer**: Performance optimization for frequently accessed data

## Components and Interfaces

### Core Services

#### Portfolio Service
**Purpose**: Provides unified view of gold holdings across all venues
**Interfaces**:
- `getPortfolio()`: Returns normalized portfolio in grams
- `refreshBalances()`: Updates balances from all connected venues
- `getVenueStatus()`: Reports connectivity status for each venue

#### Trading Engine
**Purpose**: Executes trades with risk controls and optimal routing
**Interfaces**:
- `placeLimitOrder(symbol, side, quantity, price, slippageLimit)`: Places protected limit order
- `cancelOrder(orderId)`: Cancels pending order
- `getOrderStatus(orderId)`: Returns current order status
- `getExecutionHistory()`: Returns trade execution history

#### Exchange Connector Interface
**Purpose**: Standardized interface for all exchange integrations
**Interfaces**:
- `authenticate(apiKey, secret)`: Establishes authenticated connection
- `getBalance(symbol)`: Retrieves current balance for symbol
- `placeLimitOrder(params)`: Places limit order on exchange
- `getOrderBook(symbol, depth)`: Retrieves market depth data
- `healthCheck()`: Verifies connector operational status

#### On-Chain Tracker Interface  
**Purpose**: Monitors blockchain state for supported tokens
**Interfaces**:
- `getBalance(address, tokenContract)`: Queries current token balance
- `trackTransfers(address, tokenContract)`: Monitors for new transfers
- `getConfirmationStatus(txHash)`: Returns transaction confirmation count
- `setConfirmationThreshold(confirmations)`: Configures confirmation requirements

#### Security Manager
**Purpose**: Handles all cryptographic operations and credential management
**Interfaces**:
- `storeCredentials(venue, apiKey, secret)`: Securely stores API credentials
- `retrieveCredentials(venue)`: Retrieves decrypted credentials
- `encryptSensitiveData(data)`: Encrypts data using system keys
- `validatePermissions(apiKey)`: Verifies API key has appropriate permissions

#### Audit Service
**Purpose**: Maintains tamper-evident log of all security-sensitive actions
**Interfaces**:
- `logSecurityEvent(eventType, details, userId)`: Records security event
- `logTradeExecution(orderDetails, executionResult)`: Records trade execution
- `exportAuditLog(startDate, endDate)`: Exports redacted audit records
- `verifyLogIntegrity()`: Validates audit log integrity

## Data Models

### Portfolio Model
```typescript
interface Portfolio {
  totalGrams: number;
  venues: VenueHolding[];
  lastUpdated: Date;
  status: PortfolioStatus;
}

interface VenueHolding {
  venueId: string;
  venueName: string;
  holdings: TokenHolding[];
  status: VenueStatus;
}

interface TokenHolding {
  symbol: string;
  balance: number;
  gramsEquivalent: number;
  lastUpdated: Date;
}
```

### Order Model
```typescript
interface Order {
  orderId: string;
  venueId: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit';
  quantity: number;
  price: number;
  slippageLimit: number;
  status: OrderStatus;
  createdAt: Date;
  executedAt?: Date;
  fills: Fill[];
}

interface Fill {
  fillId: string;
  quantity: number;
  price: number;
  timestamp: Date;
  fees: number;
}
```

### Connector Status Model
```typescript
interface ConnectorStatus {
  connectorId: string;
  connectorType: 'exchange' | 'onchain';
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  lastHealthCheck: Date;
  latency: number;
  errorRate: number;
  capabilities: string[];
}
```

### Audit Event Model
```typescript
interface AuditEvent {
  eventId: string;
  timestamp: Date;
  eventType: string;
  userId?: string;
  venueId?: string;
  details: Record<string, any>;
  signature: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*
Property 1: API credential validation enforces trade-only permissions
*For any* set of API credentials provided by a user, the system should accept only those credentials that have trade-only permissions without withdrawal capabilities
**Validates: Requirements 1.1**

Property 2: API credentials are encrypted at rest
*For any* API credentials stored in the system, they should be encrypted using industry-standard algorithms and accessible only with proper authorization
**Validates: Requirements 1.2, 7.1**

Property 3: Health checks verify connectivity
*For any* API connection established, a health check should be performed to verify successful connectivity before allowing trading operations
**Validates: Requirements 1.3**

Property 4: Invalid credentials are rejected with clear errors
*For any* invalid API credentials provided, the system should reject them and provide clear, informative error messages
**Validates: Requirements 1.4**

Property 5: Credential storage events are audited without exposing secrets
*For any* API credential storage operation, an audit event should be logged that records the action without exposing sensitive credential data
**Validates: Requirements 1.5**

Property 6: Portfolio holdings are normalized to grams
*For any* gold holdings across all venues, they should be displayed in the portfolio view normalized to grams regardless of the original token denomination
**Validates: Requirements 2.1**

Property 7: XAUt conversion uses correct factor
*For any* XAUt holdings, the conversion to grams should use the exact conversion factor of 31.1034768 grams per troy ounce
**Validates: Requirements 2.2**

Property 8: KAU values display without conversion
*For any* KAU holdings, the gram values should be displayed directly without any unit conversion
**Validates: Requirements 2.3**

Property 9: Portfolio updates trigger view refresh
*For any* portfolio data update, the portfolio view should refresh to reflect the current balances immediately
**Validates: Requirements 2.4**

Property 10: Connectivity loss shows appropriate status
*For any* venue that loses connectivity, the portfolio view should indicate unavailable balances with clear status indicators
**Validates: Requirements 2.5**

Property 11: Orders route to appropriate connectors
*For any* limit order placed by a user, it should be routed to the appropriate exchange connector based on the order parameters and venue availability
**Validates: Requirements 3.1**

Property 12: Slippage guard prevents excessive slippage
*For any* market conditions that would cause slippage beyond configured thresholds, the slippage guard should prevent order execution
**Validates: Requirements 3.2**

Property 13: Order executions are audited
*For any* order execution, the transaction details should be recorded in the audit trail with complete execution information
**Validates: Requirements 3.3**

Property 14: Order failures maintain system state
*For any* order execution failure, the system should provide detailed error information while maintaining consistent system state
**Validates: Requirements 3.4**

Property 15: Multi-venue routing optimizes execution
*For any* scenario with multiple available venues, orders should be routed to the venue with optimal execution conditions
**Validates: Requirements 3.5**

Property 16: Blockchain balances are queried correctly
*For any* configured blockchain address, the on-chain tracker should correctly query and return current token balances
**Validates: Requirements 4.1**

Property 17: Transfer details are completely recorded
*For any* detected blockchain transfer, all required details including amount, sender, receiver, and transaction hash should be recorded
**Validates: Requirements 4.2**

Property 18: Confirmation thresholds update balance status
*For any* transaction that reaches the required confirmation threshold, the confirmed balance status should be updated accordingly
**Validates: Requirements 4.3**

Property 19: Chain connectivity loss triggers retries
*For any* loss of blockchain connectivity, the system should indicate unavailable status and implement retry connection attempts
**Validates: Requirements 4.4**

Property 20: Balance discrepancies are flagged
*For any* detected balance discrepancy between expected and actual values, the inconsistency should be flagged for user review
**Validates: Requirements 4.5**

Property 21: Health checks execute across all venues
*For any* resilience mode test initiation, channel health checks should be executed across all connected venues
**Validates: Requirements 5.1**

Property 22: Exchange outage simulation enables fallback routing
*For any* simulated exchange outage, the specified connectors should be disabled and fallback routing functionality should be verified
**Validates: Requirements 5.2**

Property 23: Chain congestion simulation adjusts thresholds
*For any* simulated chain congestion scenario, confirmation thresholds should be increased and degraded performance scenarios should be tested
**Validates: Requirements 5.3**

Property 24: Readiness reports exclude sensitive data
*For any* completed dry-run test, a readiness summary report should be generated that excludes all sensitive information
**Validates: Requirements 5.4**

Property 25: Resilience actions are audited
*For any* resilience mode activation, all simulation actions should be logged in the audit trail for subsequent review
**Validates: Requirements 5.5**

Property 26: Audit exports include all security events
*For any* audit log export request, the generated log should include all security-sensitive actions comprehensively
**Validates: Requirements 6.1**

Property 27: Sensitive data is redacted in exports
*For any* audit data export, sensitive information including API keys and private addresses should be properly redacted
**Validates: Requirements 6.2**

Property 28: Audit entries include required metadata
*For any* audit log entry, it should include timestamps, action types, and relevant context information
**Validates: Requirements 6.3**

Property 29: Audit exports use structured format
*For any* completed audit export, the data should be provided in a structured, machine-readable format
**Validates: Requirements 6.4**

Property 30: Audit logs include integrity protection
*For any* audit log verification, cryptographic signatures or checksums should be included to prevent tampering
**Validates: Requirements 6.5**

Property 31: Data classification is applied consistently
*For any* sensitive data processing operation, data classification and redaction policies should be applied consistently
**Validates: Requirements 7.2**

Property 32: Circuit breakers halt abnormal operations
*For any* detection of abnormal activity, circuit breaker patterns should automatically halt operations to prevent damage
**Validates: Requirements 7.3**

Property 33: Authentication and authorization are enforced
*For any* user session establishment, proper authentication and authorization controls should be implemented and enforced
**Validates: Requirements 7.4**

Property 34: Security events are logged with tamper evidence
*For any* security event occurrence, the action should be logged in the tamper-evident audit trail
**Validates: Requirements 7.5**

Property 35: Health endpoints report accurate status
*For any* health check endpoint query, it should return accurate system and component status information
**Validates: Requirements 8.1**

Property 36: Performance metrics are tracked
*For any* system operation, performance indicators including response times and error rates should be tracked and reported
**Validates: Requirements 8.2**

Property 37: Status changes trigger notifications
*For any* connector status change, availability indicators should be updated and relevant monitoring systems should be notified
**Validates: Requirements 8.3**

Property 38: Errors provide structured responses
*For any* error occurrence, the system should provide structured error responses with appropriate error codes and descriptive messages
**Validates: Requirements 8.4**

Property 39: Resource monitoring triggers alerts
*For any* system resource monitoring, utilization should be tracked and alerts should be triggered when thresholds are breached
**Validates: Requirements 8.5**

## Error Handling

The system implements comprehensive error handling across all components with the following strategies:

### Error Classification
- **Transient Errors**: Network timeouts, temporary API unavailability, rate limiting
- **Configuration Errors**: Invalid API keys, malformed configuration, missing permissions
- **Business Logic Errors**: Insufficient balance, invalid order parameters, slippage violations
- **System Errors**: Database connectivity, encryption failures, internal service errors

### Error Response Strategy
- All errors include structured response format with error codes, messages, and request IDs
- Transient errors trigger automatic retry with exponential backoff
- Configuration errors require user intervention and clear remediation guidance
- Business logic errors prevent operation execution and provide specific feedback
- System errors trigger circuit breakers and alert monitoring systems

### Graceful Degradation
- Exchange connector failures enable fallback routing to alternative venues
- On-chain connectivity issues switch to cached data with staleness indicators
- Partial system outages maintain read-only functionality where possible
- Critical security failures immediately halt all trading operations

## Testing Strategy

The Gold Router App employs a comprehensive dual testing approach combining unit testing and property-based testing to ensure correctness and reliability.

### Unit Testing Approach
Unit tests verify specific examples, edge cases, and integration points between components. Key areas for unit testing include:

- **API Integration**: Test specific exchange connector implementations with known market data
- **Conversion Logic**: Verify XAUt to gram conversions with specific values
- **Error Scenarios**: Test specific error conditions and recovery mechanisms
- **Security Controls**: Validate encryption, authentication, and authorization with known inputs
- **Configuration Handling**: Test system behavior with various configuration scenarios

### Property-Based Testing Approach
Property-based tests verify universal properties that should hold across all valid inputs using **fast-check** as the property-based testing library. Each property-based test will run a minimum of 100 iterations to ensure comprehensive coverage.

Key property-based testing areas include:
- **Data Normalization**: Verify portfolio normalization works for any valid token amounts
- **Risk Controls**: Test slippage guards and circuit breakers across various market conditions  
- **Audit Integrity**: Verify audit logging completeness and tamper evidence for any sequence of operations
- **Connector Resilience**: Test failover behavior across any combination of venue availability
- **Cryptographic Operations**: Verify encryption/decryption round-trip properties for any valid data

### Testing Requirements
- Each correctness property from the design document must be implemented by a single property-based test
- Property-based tests must be tagged with comments explicitly referencing the design document property using the format: **Feature: gold-router-app, Property {number}: {property_text}**
- Unit tests and property-based tests are complementary - unit tests catch concrete bugs while property tests verify general correctness
- All tests must validate real functionality without using mocks or fake data to artificially pass tests
- Test failures must be investigated and resolved to ensure the implementation meets the specified correctness properties