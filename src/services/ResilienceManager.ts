/**
 * Resilience Manager for system health monitoring and failover
 * Implements health checking, outage simulation, and readiness reporting
 */

import { IExchangeConnector } from '../connectors/ExchangeConnector';
import { IOnChainTracker } from '../connectors/OnChainTracker';
import { ConnectorStatus, ConnectorType } from '../models/ConnectorStatus';
import { AuditService } from './AuditService';

export interface HealthCheckResult {
  connectorId: string;
  connectorType: ConnectorType;
  name: string;
  isHealthy: boolean;
  latency: number;
  error?: string;
  timestamp: Date;
}

export interface OutageSimulationConfig {
  connectorIds: string[];
  duration: number; // milliseconds
  fallbackRouting: boolean;
}

export interface CongestionSimulationConfig {
  trackerId: string;
  newConfirmationThreshold: number;
  duration: number; // milliseconds
}

export interface ReadinessReport {
  timestamp: Date;
  overallStatus: 'ready' | 'degraded' | 'not_ready';
  healthChecks: HealthCheckResult[];
  simulationResults: SimulationResult[];
  recommendations: string[];
}

export interface SimulationResult {
  type: 'outage' | 'congestion';
  success: boolean;
  details: string;
  timestamp: Date;
}

export interface VenueConfig {
  connectorId: string;
  priority: number;
  capabilities: string[];
}

/**
 * Resilience Manager class for system health monitoring and failover
 */
export class ResilienceManager {
  private exchangeConnectors: Map<string, IExchangeConnector> = new Map();
  private onChainTrackers: Map<string, IOnChainTracker> = new Map();
  private auditService: AuditService;
  private venueConfigs: Map<string, VenueConfig> = new Map();
  
  // Simulation state
  private disabledConnectors: Set<string> = new Set();
  private originalConfirmationThresholds: Map<string, number> = new Map();
  private simulationTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(auditService: AuditService) {
    this.auditService = auditService;
  }

  /**
   * Register an exchange connector
   */
  registerExchangeConnector(connector: IExchangeConnector, config: VenueConfig): void {
    this.exchangeConnectors.set(config.connectorId, connector);
    this.venueConfigs.set(config.connectorId, config);
  }

  /**
   * Register an on-chain tracker
   */
  registerOnChainTracker(tracker: IOnChainTracker, config: VenueConfig): void {
    this.onChainTrackers.set(config.connectorId, tracker);
    this.venueConfigs.set(config.connectorId, config);
  }

  /**
   * Execute health checks across all venues
   */
  async executeHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    
    // Health check all exchange connectors
    for (const [connectorId, connector] of this.exchangeConnectors) {
      const result = await this.performHealthCheck(connectorId, 'exchange', connector.healthCheck.bind(connector));
      results.push(result);
    }
    
    // Health check all on-chain trackers
    for (const [trackerId, tracker] of this.onChainTrackers) {
      const result = await this.performHealthCheck(trackerId, 'onchain', tracker.healthCheck.bind(tracker));
      results.push(result);
    }
    
    // Log health check execution
    await this.auditService.logSecurityEvent('HEALTH_CHECK_EXECUTED', {
      totalVenues: results.length,
      healthyVenues: results.filter(r => r.isHealthy).length,
      timestamp: new Date().toISOString()
    });
    
    return results;
  }

  /**
   * Perform individual health check
   */
  private async performHealthCheck(
    connectorId: string,
    connectorType: ConnectorType,
    healthCheckFn: () => Promise<boolean>
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date();
    
    try {
      // Skip if connector is disabled for simulation
      if (this.disabledConnectors.has(connectorId)) {
        return {
          connectorId,
          connectorType,
          name: this.getConnectorName(connectorId),
          isHealthy: false,
          latency: 0,
          error: 'Connector disabled for simulation',
          timestamp
        };
      }
      
      const isHealthy = await healthCheckFn();
      const latency = Date.now() - startTime;
      
      return {
        connectorId,
        connectorType,
        name: this.getConnectorName(connectorId),
        isHealthy,
        latency,
        timestamp
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      return {
        connectorId,
        connectorType,
        name: this.getConnectorName(connectorId),
        isHealthy: false,
        latency,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp
      };
    }
  }

  /**
   * Simulate exchange outage and verify fallback routing
   */
  async simulateExchangeOutage(config: OutageSimulationConfig): Promise<SimulationResult> {
    const timestamp = new Date();
    
    try {
      // Disable specified connectors
      config.connectorIds.forEach(id => {
        this.disabledConnectors.add(id);
      });
      
      // Log simulation start
      await this.auditService.logSecurityEvent('OUTAGE_SIMULATION_STARTED', {
        disabledConnectors: config.connectorIds,
        duration: config.duration,
        fallbackRouting: config.fallbackRouting,
        timestamp: timestamp.toISOString()
      });
      
      // Verify fallback routing if enabled
      let fallbackSuccess = true;
      if (config.fallbackRouting) {
        fallbackSuccess = await this.verifyFallbackRouting(config.connectorIds);
      }
      
      // Schedule re-enabling of connectors
      const timeoutId = setTimeout(() => {
        config.connectorIds.forEach(id => {
          this.disabledConnectors.delete(id);
        });
        this.simulationTimeouts.delete('outage_' + config.connectorIds.join('_'));
      }, config.duration);
      
      this.simulationTimeouts.set('outage_' + config.connectorIds.join('_'), timeoutId);
      
      const result: SimulationResult = {
        type: 'outage',
        success: fallbackSuccess,
        details: `Simulated outage for ${config.connectorIds.length} connectors. Fallback routing: ${fallbackSuccess ? 'successful' : 'failed'}`,
        timestamp
      };
      
      // Log simulation result
      await this.auditService.logSecurityEvent('OUTAGE_SIMULATION_COMPLETED', {
        result: result.success,
        details: result.details,
        timestamp: timestamp.toISOString()
      });
      
      return result;
    } catch (error) {
      // Clean up on error
      config.connectorIds.forEach(id => {
        this.disabledConnectors.delete(id);
      });
      
      const result: SimulationResult = {
        type: 'outage',
        success: false,
        details: `Outage simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp
      };
      
      await this.auditService.logSecurityEvent('OUTAGE_SIMULATION_FAILED', {
        error: result.details,
        timestamp: timestamp.toISOString()
      });
      
      return result;
    }
  }

  /**
   * Simulate chain congestion and adjust confirmation thresholds
   */
  async simulateChainCongestion(config: CongestionSimulationConfig): Promise<SimulationResult> {
    const timestamp = new Date();
    
    try {
      const tracker = this.onChainTrackers.get(config.trackerId);
      if (!tracker) {
        throw new Error(`Tracker ${config.trackerId} not found`);
      }
      
      // Store original threshold
      const originalThreshold = tracker.getConfirmationThreshold();
      this.originalConfirmationThresholds.set(config.trackerId, originalThreshold);
      
      // Set new threshold
      tracker.setConfirmationThreshold(config.newConfirmationThreshold);
      
      // Log simulation start
      await this.auditService.logSecurityEvent('CONGESTION_SIMULATION_STARTED', {
        trackerId: config.trackerId,
        originalThreshold,
        newThreshold: config.newConfirmationThreshold,
        duration: config.duration,
        timestamp: timestamp.toISOString()
      });
      
      // Schedule threshold restoration
      const timeoutId = setTimeout(() => {
        tracker.setConfirmationThreshold(originalThreshold);
        this.originalConfirmationThresholds.delete(config.trackerId);
        this.simulationTimeouts.delete('congestion_' + config.trackerId);
      }, config.duration);
      
      this.simulationTimeouts.set('congestion_' + config.trackerId, timeoutId);
      
      const result: SimulationResult = {
        type: 'congestion',
        success: true,
        details: `Chain congestion simulation: threshold increased from ${originalThreshold} to ${config.newConfirmationThreshold} confirmations`,
        timestamp
      };
      
      // Log simulation result
      await this.auditService.logSecurityEvent('CONGESTION_SIMULATION_COMPLETED', {
        result: result.success,
        details: result.details,
        timestamp: timestamp.toISOString()
      });
      
      return result;
    } catch (error) {
      const result: SimulationResult = {
        type: 'congestion',
        success: false,
        details: `Congestion simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp
      };
      
      await this.auditService.logSecurityEvent('CONGESTION_SIMULATION_FAILED', {
        error: result.details,
        timestamp: timestamp.toISOString()
      });
      
      return result;
    }
  }

  /**
   * Generate readiness report with sensitive data filtering
   */
  async generateReadinessReport(): Promise<ReadinessReport> {
    const timestamp = new Date();
    
    // Execute health checks
    const healthChecks = await this.executeHealthChecks();
    
    // Determine overall status
    const healthyCount = healthChecks.filter(hc => hc.isHealthy).length;
    const totalCount = healthChecks.length;
    
    let overallStatus: 'ready' | 'degraded' | 'not_ready';
    if (healthyCount === totalCount) {
      overallStatus = 'ready';
    } else if (healthyCount > totalCount / 2) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'not_ready';
    }
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(healthChecks);
    
    // Filter sensitive data from health checks
    const filteredHealthChecks = healthChecks.map(hc => ({
      ...hc,
      // Remove any potentially sensitive error details
      error: hc.error ? this.redactSensitiveData(hc.error) : undefined
    }));
    
    const report: ReadinessReport = {
      timestamp,
      overallStatus,
      healthChecks: filteredHealthChecks,
      simulationResults: [], // Would be populated with recent simulation results
      recommendations
    };
    
    // Log report generation
    await this.auditService.logSecurityEvent('READINESS_REPORT_GENERATED', {
      overallStatus,
      healthyVenues: healthyCount,
      totalVenues: totalCount,
      timestamp: timestamp.toISOString()
    });
    
    return report;
  }

  /**
   * Verify fallback routing functionality
   */
  private async verifyFallbackRouting(disabledConnectorIds: string[]): Promise<boolean> {
    try {
      // Get available connectors (not disabled)
      const availableConnectors = Array.from(this.exchangeConnectors.keys())
        .filter(id => !disabledConnectorIds.includes(id) && !this.disabledConnectors.has(id));
      
      if (availableConnectors.length === 0) {
        return false; // No fallback available
      }
      
      // Test that at least one fallback connector is healthy
      for (const connectorId of availableConnectors) {
        const connector = this.exchangeConnectors.get(connectorId);
        if (connector) {
          try {
            const isHealthy = await connector.healthCheck();
            if (isHealthy) {
              return true; // At least one fallback is working
            }
          } catch (error) {
            // Continue to next connector
          }
        }
      }
      
      return false; // No healthy fallbacks found
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate recommendations based on health check results
   */
  private generateRecommendations(healthChecks: HealthCheckResult[]): string[] {
    const recommendations: string[] = [];
    
    const unhealthyConnectors = healthChecks.filter(hc => !hc.isHealthy);
    const highLatencyConnectors = healthChecks.filter(hc => hc.latency > 5000); // 5 seconds
    
    if (unhealthyConnectors.length > 0) {
      recommendations.push(`${unhealthyConnectors.length} connector(s) are unhealthy and require attention`);
    }
    
    if (highLatencyConnectors.length > 0) {
      recommendations.push(`${highLatencyConnectors.length} connector(s) have high latency and may impact performance`);
    }
    
    const exchangeConnectorCount = healthChecks.filter(hc => hc.connectorType === 'exchange').length;
    const healthyExchangeCount = healthChecks.filter(hc => hc.connectorType === 'exchange' && hc.isHealthy).length;
    
    if (healthyExchangeCount < 2 && exchangeConnectorCount > 1) {
      recommendations.push('Consider enabling additional exchange connectors for better redundancy');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('All systems are operating normally');
    }
    
    return recommendations;
  }

  /**
   * Redact sensitive data from error messages
   */
  private redactSensitiveData(errorMessage: string): string {
    // Remove API keys, secrets, and other sensitive patterns
    return errorMessage
      .replace(/api[_\s-]?key[=:\s]+[a-zA-Z0-9]+/gi, 'api_key=***')
      .replace(/secret[=:\s]+[a-zA-Z0-9]+/gi, 'secret=***')
      .replace(/token[=:\s]+[a-zA-Z0-9]+/gi, 'token=***')
      .replace(/password[=:\s]+[a-zA-Z0-9]+/gi, 'password=***')
      .replace(/0x[a-fA-F0-9]{40}/g, '0x***') // Ethereum addresses
      .replace(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/g, '***'); // Bitcoin addresses
  }

  /**
   * Get connector name by ID
   */
  private getConnectorName(connectorId: string): string {
    const config = this.venueConfigs.get(connectorId);
    return config ? `${connectorId}` : connectorId;
  }

  /**
   * Clean up all active simulations
   */
  async cleanupSimulations(): Promise<void> {
    // Clear all timeouts
    for (const [key, timeout] of this.simulationTimeouts) {
      clearTimeout(timeout);
    }
    this.simulationTimeouts.clear();
    
    // Re-enable all disabled connectors
    this.disabledConnectors.clear();
    
    // Restore original confirmation thresholds
    for (const [trackerId, originalThreshold] of this.originalConfirmationThresholds) {
      const tracker = this.onChainTrackers.get(trackerId);
      if (tracker) {
        tracker.setConfirmationThreshold(originalThreshold);
      }
    }
    this.originalConfirmationThresholds.clear();
    
    await this.auditService.logSecurityEvent('SIMULATIONS_CLEANED_UP', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get current system status
   */
  async getSystemStatus(): Promise<ConnectorStatus[]> {
    const statuses: ConnectorStatus[] = [];
    
    // Get exchange connector statuses
    for (const [connectorId, connector] of this.exchangeConnectors) {
      const status = connector.getStatus();
      // Override status if disabled for simulation
      if (this.disabledConnectors.has(connectorId)) {
        status.status = 'offline';
      }
      statuses.push(status);
    }
    
    // Get on-chain tracker statuses
    for (const [trackerId, tracker] of this.onChainTrackers) {
      const status = tracker.getStatus();
      statuses.push(status);
    }
    
    return statuses;
  }
}