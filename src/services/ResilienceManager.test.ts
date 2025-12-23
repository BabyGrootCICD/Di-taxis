/**
 * Property-based tests for ResilienceManager
 * Tests resilience functionality and health checking capabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ResilienceManager, VenueConfig, OutageSimulationConfig, CongestionSimulationConfig } from './ResilienceManager';
import { AuditService } from './AuditService';
import { IExchangeConnector } from '../connectors/ExchangeConnector';
import { IOnChainTracker } from '../connectors/OnChainTracker';
import { ConnectorStatus } from '../models/ConnectorStatus';

// Mock implementations for testing
class MockExchangeConnector implements IExchangeConnector {
  private isHealthy: boolean;
  private latency: number;
  
  constructor(isHealthy: boolean = true, latency: number = 100) {
    this.isHealthy = isHealthy;
    this.latency = latency;
  }
  
  async authenticate(): Promise<boolean> { return true; }
  async getBalance(): Promise<any> { return { symbol: 'XAU', available: 100, total: 100 }; }
  async placeLimitOrder(): Promise<any> { return { orderId: '123', status: 'pending', timestamp: new Date() }; }
  async getOrderBook(): Promise<any> { return { bids: [], asks: [], timestamp: new Date() }; }
  async cancelOrder(): Promise<boolean> { return true; }
  async getOrderStatus(): Promise<any> { return null; }
  
  async healthCheck(): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, this.latency));
    return this.isHealthy;
  }
  
  getStatus(): ConnectorStatus {
    return {
      connectorId: 'mock-exchange',
      connectorType: 'exchange',
      name: 'Mock Exchange',
      status: this.isHealthy ? 'healthy' : 'offline',
      lastHealthCheck: new Date(),
      latency: this.latency,
      errorRate: 0,
      capabilities: ['trading']
    };
  }
}

class MockOnChainTracker implements IOnChainTracker {
  private isHealthy: boolean;
  private latency: number;
  private confirmationThreshold: number = 12;
  
  constructor(isHealthy: boolean = true, latency: number = 200) {
    this.isHealthy = isHealthy;
    this.latency = latency;
  }
  
  async getBalance(): Promise<any> { return { address: '0x123', tokenContract: '0x456', symbol: 'XAU', balance: 100, decimals: 18, lastUpdated: new Date() }; }
  async trackTransfers(): Promise<any[]> { return []; }
  async getConfirmationStatus(): Promise<any> { return { transactionHash: '0x789', confirmations: 12, requiredConfirmations: 12, isConfirmed: true, blockNumber: 1000, timestamp: new Date() }; }
  async startMonitoring(): Promise<void> {}
  async stopMonitoring(): Promise<void> {}
  
  setConfirmationThreshold(confirmations: number): void {
    this.confirmationThreshold = confirmations;
  }
  
  getConfirmationThreshold(): number {
    return this.confirmationThreshold;
  }
  
  async healthCheck(): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, this.latency));
    return this.isHealthy;
  }
  
  getStatus(): ConnectorStatus {
    return {
      connectorId: 'mock-tracker',
      connectorType: 'onchain',
      name: 'Mock Tracker',
      status: this.isHealthy ? 'healthy' : 'offline',
      lastHealthCheck: new Date(),
      latency: this.latency,
      errorRate: 0,
      capabilities: ['balance_tracking']
    };
  }
}

describe('ResilienceManager Property Tests', () => {
  let resilienceManager: ResilienceManager;
  let mockAuditService: AuditService;

  beforeEach(() => {
    // Create mock audit service
    mockAuditService = {
      logSecurityEvent: vi.fn().mockResolvedValue(undefined),
      logTradeExecution: vi.fn().mockResolvedValue(undefined),
      exportAuditLog: vi.fn().mockResolvedValue([]),
      verifyLogIntegrity: vi.fn().mockResolvedValue(true)
    } as any;
    
    resilienceManager = new ResilienceManager(mockAuditService);
  });

  /**
   * **Feature: gold-router-app, Property 21: Health checks execute across all venues**
   * **Validates: Requirements 5.1**
   */
  it('should execute health checks across all registered venues', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate random venue configurations
      fc.array(
        fc.record({
          connectorId: fc.string({ minLength: 1, maxLength: 10 }),
          isHealthy: fc.boolean(),
          latency: fc.integer({ min: 10, max: 50 }),
          connectorType: fc.constantFrom('exchange', 'onchain')
        }),
        { minLength: 1, maxLength: 5 }
      ),
      async (venueConfigs) => {
        // Create fresh resilience manager for each test
        const testResilienceManager = new ResilienceManager(mockAuditService);
        
        // Register venues based on generated configurations
        const registeredVenues = new Set<string>();
        
        for (const config of venueConfigs) {
          // Ensure unique connector IDs
          if (registeredVenues.has(config.connectorId)) {
            continue;
          }
          registeredVenues.add(config.connectorId);
          
          const venueConfig: VenueConfig = {
            connectorId: config.connectorId,
            priority: 1,
            capabilities: ['trading']
          };
          
          if (config.connectorType === 'exchange') {
            const mockConnector = new MockExchangeConnector(config.isHealthy, config.latency);
            testResilienceManager.registerExchangeConnector(mockConnector, venueConfig);
          } else {
            const mockTracker = new MockOnChainTracker(config.isHealthy, config.latency);
            testResilienceManager.registerOnChainTracker(mockTracker, venueConfig);
          }
        }
        
        // Execute health checks
        const healthCheckResults = await testResilienceManager.executeHealthChecks();
        
        // Property: Health checks should be executed for all registered venues
        expect(healthCheckResults).toHaveLength(registeredVenues.size);
        
        // Each health check result should correspond to a registered venue
        const resultConnectorIds = new Set(healthCheckResults.map(r => r.connectorId));
        expect(resultConnectorIds).toEqual(registeredVenues);
        
        // Each health check should have the expected structure
        for (const result of healthCheckResults) {
          expect(result).toHaveProperty('connectorId');
          expect(result).toHaveProperty('connectorType');
          expect(result).toHaveProperty('name');
          expect(result).toHaveProperty('isHealthy');
          expect(result).toHaveProperty('latency');
          expect(result).toHaveProperty('timestamp');
          expect(typeof result.isHealthy).toBe('boolean');
          expect(typeof result.latency).toBe('number');
          expect(result.latency).toBeGreaterThanOrEqual(0);
        }
        
        // Verify audit logging was called
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'HEALTH_CHECK_EXECUTED',
          expect.objectContaining({
            totalVenues: registeredVenues.size,
            healthyVenues: expect.any(Number)
          })
        );
      }
    ), { numRuns: 20 });
  }, 10000);

  /**
   * **Feature: gold-router-app, Property 22: Exchange outage simulation enables fallback routing**
   * **Validates: Requirements 5.2**
   */
  it('should enable fallback routing when simulating exchange outages', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate exchange connectors and outage configurations
      fc.record({
        exchangeConnectors: fc.array(
          fc.record({
            connectorId: fc.string({ minLength: 1, maxLength: 10 }),
            isHealthy: fc.boolean()
          }),
          { minLength: 2, maxLength: 5 }
        ),
        outageConnectorIds: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
        duration: fc.integer({ min: 100, max: 1000 }),
        fallbackRouting: fc.boolean()
      }),
      async ({ exchangeConnectors, outageConnectorIds, duration, fallbackRouting }) => {
        // Create fresh resilience manager for each test
        const testResilienceManager = new ResilienceManager(mockAuditService);
        
        // Register exchange connectors with unique IDs
        const registeredConnectors = new Set<string>();
        const healthyConnectors = new Set<string>();
        
        for (const config of exchangeConnectors) {
          if (registeredConnectors.has(config.connectorId)) {
            continue;
          }
          registeredConnectors.add(config.connectorId);
          
          if (config.isHealthy) {
            healthyConnectors.add(config.connectorId);
          }
          
          const venueConfig: VenueConfig = {
            connectorId: config.connectorId,
            priority: 1,
            capabilities: ['trading']
          };
          
          const mockConnector = new MockExchangeConnector(config.isHealthy, 10);
          testResilienceManager.registerExchangeConnector(mockConnector, venueConfig);
        }
        
        // Only test with connectors that were actually registered
        const validOutageIds = outageConnectorIds.filter(id => registeredConnectors.has(id));
        
        if (validOutageIds.length === 0) {
          return; // Skip if no valid outage connectors
        }
        
        const outageConfig: OutageSimulationConfig = {
          connectorIds: validOutageIds,
          duration,
          fallbackRouting
        };
        
        // Simulate outage
        const simulationResult = await testResilienceManager.simulateExchangeOutage(outageConfig);
        
        // Property: Outage simulation should complete successfully
        expect(simulationResult.type).toBe('outage');
        expect(simulationResult.timestamp).toBeInstanceOf(Date);
        expect(typeof simulationResult.success).toBe('boolean');
        expect(typeof simulationResult.details).toBe('string');
        
        // If fallback routing is enabled and there are healthy non-outage connectors,
        // the simulation should succeed
        const availableHealthyConnectors = Array.from(healthyConnectors)
          .filter(id => !validOutageIds.includes(id));
        
        if (fallbackRouting && availableHealthyConnectors.length > 0) {
          expect(simulationResult.success).toBe(true);
          expect(simulationResult.details).toContain('successful');
        }
        
        // Verify that health checks show disabled connectors as unhealthy
        const healthCheckResults = await testResilienceManager.executeHealthChecks();
        const disabledResults = healthCheckResults.filter(r => validOutageIds.includes(r.connectorId));
        
        for (const result of disabledResults) {
          expect(result.isHealthy).toBe(false);
          expect(result.error).toContain('disabled for simulation');
        }
        
        // Verify audit logging was called
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'OUTAGE_SIMULATION_STARTED',
          expect.objectContaining({
            disabledConnectors: validOutageIds,
            duration,
            fallbackRouting
          })
        );
        
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'OUTAGE_SIMULATION_COMPLETED',
          expect.objectContaining({
            result: simulationResult.success
          })
        );
        
        // Clean up simulation
        await testResilienceManager.cleanupSimulations();
        
        // After cleanup, connectors should be healthy again (if they were originally healthy)
        const postCleanupResults = await testResilienceManager.executeHealthChecks();
        for (const result of postCleanupResults) {
          const originalConfig = exchangeConnectors.find(c => c.connectorId === result.connectorId);
          if (originalConfig?.isHealthy) {
            expect(result.isHealthy).toBe(true);
          }
        }
      }
    ), { numRuns: 20 });
  }, 10000);

  /**
   * **Feature: gold-router-app, Property 23: Chain congestion simulation adjusts thresholds**
   * **Validates: Requirements 5.3**
   */
  it('should adjust confirmation thresholds when simulating chain congestion', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate tracker configurations and congestion simulation parameters
      fc.record({
        trackers: fc.array(
          fc.record({
            trackerId: fc.string({ minLength: 1, maxLength: 10 }),
            isHealthy: fc.boolean(),
            originalThreshold: fc.integer({ min: 1, max: 20 })
          }),
          { minLength: 1, maxLength: 3 }
        ),
        targetTrackerId: fc.string({ minLength: 1, maxLength: 10 }),
        newThreshold: fc.integer({ min: 5, max: 50 }),
        duration: fc.integer({ min: 100, max: 1000 })
      }),
      async ({ trackers, targetTrackerId, newThreshold, duration }) => {
        // Create fresh resilience manager for each test
        const testResilienceManager = new ResilienceManager(mockAuditService);
        
        // Register on-chain trackers with unique IDs
        const registeredTrackers = new Map<string, MockOnChainTracker>();
        
        for (const config of trackers) {
          if (registeredTrackers.has(config.trackerId)) {
            continue;
          }
          
          const venueConfig: VenueConfig = {
            connectorId: config.trackerId,
            priority: 1,
            capabilities: ['balance_tracking']
          };
          
          const mockTracker = new MockOnChainTracker(config.isHealthy, 10);
          mockTracker.setConfirmationThreshold(config.originalThreshold);
          
          registeredTrackers.set(config.trackerId, mockTracker);
          testResilienceManager.registerOnChainTracker(mockTracker, venueConfig);
        }
        
        // Only test if the target tracker was actually registered
        const targetTracker = registeredTrackers.get(targetTrackerId);
        if (!targetTracker) {
          return; // Skip if target tracker not registered
        }
        
        const originalThreshold = targetTracker.getConfirmationThreshold();
        
        const congestionConfig: CongestionSimulationConfig = {
          trackerId: targetTrackerId,
          newConfirmationThreshold: newThreshold,
          duration
        };
        
        // Simulate chain congestion
        const simulationResult = await testResilienceManager.simulateChainCongestion(congestionConfig);
        
        // Property: Congestion simulation should complete successfully
        expect(simulationResult.type).toBe('congestion');
        expect(simulationResult.timestamp).toBeInstanceOf(Date);
        expect(typeof simulationResult.success).toBe('boolean');
        expect(typeof simulationResult.details).toBe('string');
        expect(simulationResult.success).toBe(true);
        
        // Property: Confirmation threshold should be adjusted during simulation
        expect(targetTracker.getConfirmationThreshold()).toBe(newThreshold);
        expect(simulationResult.details).toContain(`threshold increased from ${originalThreshold} to ${newThreshold}`);
        
        // Verify audit logging was called
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'CONGESTION_SIMULATION_STARTED',
          expect.objectContaining({
            trackerId: targetTrackerId,
            originalThreshold,
            newThreshold,
            duration
          })
        );
        
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'CONGESTION_SIMULATION_COMPLETED',
          expect.objectContaining({
            result: true
          })
        );
        
        // Clean up simulation
        await testResilienceManager.cleanupSimulations();
        
        // Property: After cleanup, threshold should be restored to original value
        expect(targetTracker.getConfirmationThreshold()).toBe(originalThreshold);
      }
    ), { numRuns: 20 });
  }, 10000);

  /**
   * **Feature: gold-router-app, Property 24: Readiness reports exclude sensitive data**
   * **Validates: Requirements 5.4**
   */
  it('should exclude sensitive data from readiness reports', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate venue configurations with potential sensitive data in errors
      fc.array(
        fc.record({
          connectorId: fc.string({ minLength: 1, maxLength: 10 }),
          connectorType: fc.constantFrom('exchange', 'onchain'),
          isHealthy: fc.boolean(),
          errorMessage: fc.option(
            fc.oneof(
              fc.constant('API key abc123def456 is invalid'),
              fc.constant('Secret xyz789 authentication failed'),
              fc.constant('Token bearer_token_12345 expired'),
              fc.constant('Password mypassword123 is incorrect'),
              fc.constant('Address 0x1234567890123456789012345678901234567890 not found'),
              fc.constant('Bitcoin address 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa invalid'),
              fc.constant('Connection timeout to server'),
              fc.constant('Network unreachable')
            )
          )
        }),
        { minLength: 1, maxLength: 5 }
      ),
      async (venueConfigs) => {
        // Create fresh resilience manager for each test
        const testResilienceManager = new ResilienceManager(mockAuditService);
        
        // Register venues with unique IDs and potential sensitive errors
        const registeredVenues = new Set<string>();
        const sensitiveErrors = new Map<string, string>();
        
        for (const config of venueConfigs) {
          if (registeredVenues.has(config.connectorId)) {
            continue;
          }
          registeredVenues.add(config.connectorId);
          
          const venueConfig: VenueConfig = {
            connectorId: config.connectorId,
            priority: 1,
            capabilities: ['trading']
          };
          
          if (config.connectorType === 'exchange') {
            const mockConnector = new MockExchangeConnector(config.isHealthy, 10);
            
            // Override healthCheck to throw error with sensitive data if needed
            if (!config.isHealthy && config.errorMessage) {
              sensitiveErrors.set(config.connectorId, config.errorMessage);
              mockConnector.healthCheck = async () => {
                throw new Error(config.errorMessage);
              };
            }
            
            testResilienceManager.registerExchangeConnector(mockConnector, venueConfig);
          } else {
            const mockTracker = new MockOnChainTracker(config.isHealthy, 10);
            
            // Override healthCheck to throw error with sensitive data if needed
            if (!config.isHealthy && config.errorMessage) {
              sensitiveErrors.set(config.connectorId, config.errorMessage);
              mockTracker.healthCheck = async () => {
                throw new Error(config.errorMessage);
              };
            }
            
            testResilienceManager.registerOnChainTracker(mockTracker, venueConfig);
          }
        }
        
        // Generate readiness report
        const readinessReport = await testResilienceManager.generateReadinessReport();
        
        // Property: Readiness report should have expected structure
        expect(readinessReport).toHaveProperty('timestamp');
        expect(readinessReport).toHaveProperty('overallStatus');
        expect(readinessReport).toHaveProperty('healthChecks');
        expect(readinessReport).toHaveProperty('simulationResults');
        expect(readinessReport).toHaveProperty('recommendations');
        
        expect(readinessReport.timestamp).toBeInstanceOf(Date);
        expect(['ready', 'degraded', 'not_ready']).toContain(readinessReport.overallStatus);
        expect(Array.isArray(readinessReport.healthChecks)).toBe(true);
        expect(Array.isArray(readinessReport.simulationResults)).toBe(true);
        expect(Array.isArray(readinessReport.recommendations)).toBe(true);
        
        // Property: Health checks should be included for all registered venues
        expect(readinessReport.healthChecks).toHaveLength(registeredVenues.size);
        
        // Property: Sensitive data should be redacted from error messages
        for (const healthCheck of readinessReport.healthChecks) {
          if (healthCheck.error) {
            const originalError = sensitiveErrors.get(healthCheck.connectorId);
            if (originalError) {
              // Check that sensitive patterns are redacted
              expect(healthCheck.error).not.toMatch(/api[_-]?key[=:\s]+[a-zA-Z0-9]+/i);
              expect(healthCheck.error).not.toMatch(/secret[=:\s]+[a-zA-Z0-9]+/i);
              expect(healthCheck.error).not.toMatch(/token[=:\s]+[a-zA-Z0-9]+/i);
              expect(healthCheck.error).not.toMatch(/password[=:\s]+[a-zA-Z0-9]+/i);
              expect(healthCheck.error).not.toMatch(/0x[a-fA-F0-9]{40}/);
              expect(healthCheck.error).not.toMatch(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/);
              
              // Should contain redacted markers instead
              if (originalError.includes('api') || originalError.includes('API')) {
                expect(healthCheck.error).toContain('***');
              }
            }
          }
        }
        
        // Property: Overall status should reflect health check results
        const healthyCount = readinessReport.healthChecks.filter(hc => hc.isHealthy).length;
        const totalCount = readinessReport.healthChecks.length;
        
        if (healthyCount === totalCount) {
          expect(readinessReport.overallStatus).toBe('ready');
        } else if (healthyCount > totalCount / 2) {
          expect(readinessReport.overallStatus).toBe('degraded');
        } else {
          expect(readinessReport.overallStatus).toBe('not_ready');
        }
        
        // Property: Recommendations should be provided
        expect(readinessReport.recommendations.length).toBeGreaterThan(0);
        
        // Verify audit logging was called
        expect(mockAuditService.logSecurityEvent).toHaveBeenCalledWith(
          'READINESS_REPORT_GENERATED',
          expect.objectContaining({
            overallStatus: readinessReport.overallStatus,
            healthyVenues: healthyCount,
            totalVenues: totalCount
          })
        );
      }
    ), { numRuns: 20 });
  }, 10000);
});