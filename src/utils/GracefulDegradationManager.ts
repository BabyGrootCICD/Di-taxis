/**
 * Graceful Degradation Manager
 * Handles partial system failures by providing reduced functionality
 */

import { ConnectorStatus } from '../models/ConnectorStatus';
import { ApplicationError, ErrorCategory, ErrorSeverity } from './ErrorHandler';
import { AuditService } from '../services/AuditService';

export enum DegradationLevel {
  NONE = 'none',
  MINIMAL = 'minimal',
  MODERATE = 'moderate',
  SEVERE = 'severe',
  CRITICAL = 'critical'
}

export enum ServiceCapability {
  TRADING = 'trading',
  PORTFOLIO_VIEW = 'portfolio_view',
  BALANCE_QUERY = 'balance_query',
  ORDER_HISTORY = 'order_history',
  HEALTH_MONITORING = 'health_monitoring',
  AUDIT_LOGGING = 'audit_logging',
  REAL_TIME_DATA = 'real_time_data',
  MULTI_VENUE_ROUTING = 'multi_venue_routing'
}

export interface DegradationRule {
  capability: ServiceCapability;
  requiredServices: string[];
  fallbackFunction?: () => Promise<any>;
  degradedFunction?: () => Promise<any>;
  minHealthyServices: number;
  priority: number; // Higher number = higher priority
}

export interface ServiceHealth {
  serviceId: string;
  isHealthy: boolean;
  lastCheck: Date;
  errorCount: number;
  capabilities: ServiceCapability[];
}

export interface DegradationStatus {
  level: DegradationLevel;
  availableCapabilities: ServiceCapability[];
  unavailableCapabilities: ServiceCapability[];
  affectedServices: string[];
  recommendations: string[];
  timestamp: Date;
}

export interface FallbackData {
  type: string;
  data: any;
  timestamp: Date;
  source: string;
  isStale: boolean;
}

/**
 * Manages graceful degradation of system capabilities
 */
export class GracefulDegradationManager {
  private degradationRules: Map<ServiceCapability, DegradationRule> = new Map();
  private serviceHealth: Map<string, ServiceHealth> = new Map();
  private fallbackCache: Map<string, FallbackData> = new Map();
  private auditService: AuditService;
  private currentDegradationLevel: DegradationLevel = DegradationLevel.NONE;
  private cacheExpiryMs: number = 5 * 60 * 1000; // 5 minutes

  constructor(auditService: AuditService) {
    this.auditService = auditService;
    this.initializeDefaultRules();
  }

  /**
   * Updates service health status
   */
  updateServiceHealth(serviceId: string, status: ConnectorStatus): void {
    const isHealthy = status.status === 'healthy';
    const existing = this.serviceHealth.get(serviceId);
    
    const health: ServiceHealth = {
      serviceId,
      isHealthy,
      lastCheck: new Date(),
      errorCount: existing ? (isHealthy ? 0 : existing.errorCount + 1) : (isHealthy ? 0 : 1),
      capabilities: this.getServiceCapabilities(serviceId, status)
    };

    this.serviceHealth.set(serviceId, health);
    
    // Recalculate degradation level
    this.updateDegradationLevel();
  }

  /**
   * Gets current degradation status
   */
  getDegradationStatus(): DegradationStatus {
    const availableCapabilities: ServiceCapability[] = [];
    const unavailableCapabilities: ServiceCapability[] = [];
    const affectedServices: string[] = [];

    // Check each capability
    for (const [capability, rule] of this.degradationRules) {
      const healthyServices = this.getHealthyServicesForCapability(capability);
      
      if (healthyServices.length >= rule.minHealthyServices) {
        availableCapabilities.push(capability);
      } else {
        unavailableCapabilities.push(capability);
        // Add affected services
        rule.requiredServices.forEach(serviceId => {
          const health = this.serviceHealth.get(serviceId);
          if (health && !health.isHealthy && !affectedServices.includes(serviceId)) {
            affectedServices.push(serviceId);
          }
        });
      }
    }

    const recommendations = this.generateRecommendations(unavailableCapabilities, affectedServices);

    return {
      level: this.currentDegradationLevel,
      availableCapabilities,
      unavailableCapabilities,
      affectedServices,
      recommendations,
      timestamp: new Date()
    };
  }

  /**
   * Executes operation with graceful degradation
   */
  async executeWithDegradation<T>(
    capability: ServiceCapability,
    primaryOperation: () => Promise<T>,
    context: {
      operation: string;
      component: string;
      userId?: string;
    }
  ): Promise<T> {
    const rule = this.degradationRules.get(capability);
    if (!rule) {
      // No degradation rule, execute normally
      return await primaryOperation();
    }

    const healthyServices = this.getHealthyServicesForCapability(capability);
    
    // Check if we have enough healthy services
    if (healthyServices.length >= rule.minHealthyServices) {
      try {
        return await primaryOperation();
      } catch (error) {
        // Primary operation failed, try fallback
        return await this.tryFallbackOperation(capability, rule, error, context);
      }
    } else {
      // Not enough healthy services, use degraded mode
      return await this.tryDegradedOperation(capability, rule, context);
    }
  }

  /**
   * Caches data for fallback use
   */
  cacheFallbackData(key: string, data: any, source: string): void {
    this.fallbackCache.set(key, {
      type: key,
      data,
      timestamp: new Date(),
      source,
      isStale: false
    });

    // Clean up expired cache entries
    this.cleanupExpiredCache();
  }

  /**
   * Gets cached fallback data
   */
  getFallbackData(key: string): FallbackData | null {
    const cached = this.fallbackCache.get(key);
    if (!cached) return null;

    // Check if data is stale
    const age = Date.now() - cached.timestamp.getTime();
    if (age > this.cacheExpiryMs) {
      cached.isStale = true;
    }

    return cached;
  }

  /**
   * Registers a degradation rule
   */
  registerDegradationRule(capability: ServiceCapability, rule: DegradationRule): void {
    this.degradationRules.set(capability, rule);
  }

  /**
   * Gets available capabilities for current degradation level
   */
  getAvailableCapabilities(): ServiceCapability[] {
    const status = this.getDegradationStatus();
    return status.availableCapabilities;
  }

  /**
   * Checks if a capability is available
   */
  isCapabilityAvailable(capability: ServiceCapability): boolean {
    const rule = this.degradationRules.get(capability);
    if (!rule) return true;

    const healthyServices = this.getHealthyServicesForCapability(capability);
    return healthyServices.length >= rule.minHealthyServices;
  }

  /**
   * Gets user-friendly status message
   */
  getStatusMessage(): string {
    switch (this.currentDegradationLevel) {
      case DegradationLevel.NONE:
        return 'All systems operational';
      case DegradationLevel.MINIMAL:
        return 'Minor service disruption - some features may be limited';
      case DegradationLevel.MODERATE:
        return 'Moderate service disruption - operating in reduced functionality mode';
      case DegradationLevel.SEVERE:
        return 'Severe service disruption - only essential functions available';
      case DegradationLevel.CRITICAL:
        return 'Critical service disruption - system operating in emergency mode';
      default:
        return 'System status unknown';
    }
  }

  /**
   * Tries fallback operation when primary fails
   */
  private async tryFallbackOperation<T>(
    capability: ServiceCapability,
    rule: DegradationRule,
    error: any,
    context: any
  ): Promise<T> {
    if (rule.fallbackFunction) {
      try {
        const result = await rule.fallbackFunction();
        
        // Log successful fallback
        this.auditService.logSecurityEvent('FALLBACK_OPERATION_SUCCESS', {
          capability,
          operation: context.operation,
          component: context.component,
          originalError: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        }, context.userId);

        return result;
      } catch (fallbackError) {
        // Fallback also failed, try degraded mode
        return await this.tryDegradedOperation(capability, rule, context);
      }
    } else {
      // No fallback available, try degraded mode
      return await this.tryDegradedOperation(capability, rule, context);
    }
  }

  /**
   * Tries degraded operation when services are unavailable
   */
  private async tryDegradedOperation<T>(
    capability: ServiceCapability,
    rule: DegradationRule,
    context: any
  ): Promise<T> {
    if (rule.degradedFunction) {
      try {
        const result = await rule.degradedFunction();
        
        // Log degraded operation
        this.auditService.logSecurityEvent('DEGRADED_OPERATION_SUCCESS', {
          capability,
          operation: context.operation,
          component: context.component,
          degradationLevel: this.currentDegradationLevel,
          timestamp: new Date().toISOString()
        }, context.userId);

        return result;
      } catch (degradedError) {
        throw new ApplicationError(
          `Operation failed in degraded mode: ${degradedError instanceof Error ? degradedError.message : 'Unknown error'}`,
          'DEGRADED_OPERATION_FAILED',
          ErrorCategory.SYSTEM,
          ErrorSeverity.HIGH,
          {
            operation: context.operation,
            component: context.component,
            timestamp: new Date()
          },
          {
            originalError: degradedError instanceof Error ? degradedError : undefined,
            userMessage: `${capability} is currently unavailable due to system issues. Please try again later.`
          }
        );
      }
    } else {
      throw new ApplicationError(
        `Capability ${capability} is unavailable and no degraded mode is configured`,
        'CAPABILITY_UNAVAILABLE',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: context.operation,
          component: context.component,
          timestamp: new Date()
        },
        {
          userMessage: `${capability} is currently unavailable due to system issues. Please try again later.`
        }
      );
    }
  }

  /**
   * Gets healthy services that support a capability
   */
  private getHealthyServicesForCapability(capability: ServiceCapability): string[] {
    const healthyServices: string[] = [];
    
    for (const [serviceId, health] of this.serviceHealth) {
      if (health.isHealthy && health.capabilities.includes(capability)) {
        healthyServices.push(serviceId);
      }
    }
    
    return healthyServices;
  }

  /**
   * Updates the current degradation level
   */
  private updateDegradationLevel(): void {
    const totalServices = this.serviceHealth.size;
    const healthyServices = Array.from(this.serviceHealth.values()).filter(h => h.isHealthy).length;
    
    if (totalServices === 0) {
      this.currentDegradationLevel = DegradationLevel.NONE;
      return;
    }

    const healthyPercentage = healthyServices / totalServices;
    const previousLevel = this.currentDegradationLevel;

    if (healthyPercentage >= 0.9) {
      this.currentDegradationLevel = DegradationLevel.NONE;
    } else if (healthyPercentage >= 0.7) {
      this.currentDegradationLevel = DegradationLevel.MINIMAL;
    } else if (healthyPercentage >= 0.5) {
      this.currentDegradationLevel = DegradationLevel.MODERATE;
    } else if (healthyPercentage >= 0.3) {
      this.currentDegradationLevel = DegradationLevel.SEVERE;
    } else {
      this.currentDegradationLevel = DegradationLevel.CRITICAL;
    }

    // Log degradation level changes
    if (previousLevel !== this.currentDegradationLevel) {
      this.auditService.logSecurityEvent('DEGRADATION_LEVEL_CHANGED', {
        previousLevel,
        newLevel: this.currentDegradationLevel,
        healthyServices,
        totalServices,
        healthyPercentage: Math.round(healthyPercentage * 100),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Gets service capabilities based on connector status
   */
  private getServiceCapabilities(serviceId: string, status: ConnectorStatus): ServiceCapability[] {
    const capabilities: ServiceCapability[] = [];
    
    // Map connector capabilities to service capabilities
    if (status.capabilities.includes('balance-query')) {
      capabilities.push(ServiceCapability.BALANCE_QUERY);
      capabilities.push(ServiceCapability.PORTFOLIO_VIEW);
    }
    
    if (status.capabilities.includes('order-placement')) {
      capabilities.push(ServiceCapability.TRADING);
    }
    
    if (status.capabilities.includes('order-history')) {
      capabilities.push(ServiceCapability.ORDER_HISTORY);
    }
    
    if (status.capabilities.includes('market-data')) {
      capabilities.push(ServiceCapability.REAL_TIME_DATA);
    }
    
    // Exchange connectors support multi-venue routing
    if (status.connectorType === 'exchange') {
      capabilities.push(ServiceCapability.MULTI_VENUE_ROUTING);
    }
    
    // All services support health monitoring
    capabilities.push(ServiceCapability.HEALTH_MONITORING);
    
    return capabilities;
  }

  /**
   * Generates recommendations based on degradation status
   */
  private generateRecommendations(
    unavailableCapabilities: ServiceCapability[],
    affectedServices: string[]
  ): string[] {
    const recommendations: string[] = [];
    
    if (unavailableCapabilities.includes(ServiceCapability.TRADING)) {
      recommendations.push('Trading is currently unavailable. Check exchange connectivity and API credentials.');
    }
    
    if (unavailableCapabilities.includes(ServiceCapability.REAL_TIME_DATA)) {
      recommendations.push('Real-time data is unavailable. Portfolio values may be stale.');
    }
    
    if (unavailableCapabilities.includes(ServiceCapability.MULTI_VENUE_ROUTING)) {
      recommendations.push('Multi-venue routing is limited. Orders may have reduced execution options.');
    }
    
    if (affectedServices.length > 0) {
      recommendations.push(`Check the following services: ${affectedServices.join(', ')}`);
    }
    
    if (this.currentDegradationLevel === DegradationLevel.CRITICAL) {
      recommendations.push('System is in critical state. Consider manual intervention.');
    }
    
    return recommendations;
  }

  /**
   * Cleans up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, data] of this.fallbackCache) {
      if (now - data.timestamp.getTime() > this.cacheExpiryMs * 2) { // Double expiry for cleanup
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.fallbackCache.delete(key));
  }

  /**
   * Initializes default degradation rules
   */
  private initializeDefaultRules(): void {
    // Trading capability
    this.registerDegradationRule(ServiceCapability.TRADING, {
      capability: ServiceCapability.TRADING,
      requiredServices: ['exchange-connector'],
      minHealthyServices: 1,
      priority: 10,
      fallbackFunction: async () => {
        throw new ApplicationError(
          'Trading is temporarily unavailable',
          'TRADING_UNAVAILABLE',
          ErrorCategory.EXTERNAL_SERVICE,
          ErrorSeverity.HIGH,
          {
            operation: 'trading',
            component: 'GracefulDegradationManager',
            timestamp: new Date()
          },
          {
            userMessage: 'Trading is currently unavailable. Please try again later or use a different exchange.'
          }
        );
      }
    });

    // Portfolio view capability
    this.registerDegradationRule(ServiceCapability.PORTFOLIO_VIEW, {
      capability: ServiceCapability.PORTFOLIO_VIEW,
      requiredServices: ['portfolio-service'],
      minHealthyServices: 1,
      priority: 8,
      degradedFunction: async () => {
        // Return cached portfolio data
        const cached = this.getFallbackData('portfolio');
        if (cached) {
          return {
            ...cached.data,
            isStale: cached.isStale,
            lastUpdated: cached.timestamp,
            warning: 'Portfolio data may be outdated due to connectivity issues'
          };
        }
        throw new ApplicationError(
          'Portfolio data unavailable',
          'PORTFOLIO_UNAVAILABLE',
          ErrorCategory.SYSTEM,
          ErrorSeverity.MEDIUM,
          {
            operation: 'portfolio_view',
            component: 'GracefulDegradationManager',
            timestamp: new Date()
          }
        );
      }
    });

    // Balance query capability
    this.registerDegradationRule(ServiceCapability.BALANCE_QUERY, {
      capability: ServiceCapability.BALANCE_QUERY,
      requiredServices: ['exchange-connector', 'onchain-tracker'],
      minHealthyServices: 1,
      priority: 7,
      degradedFunction: async () => {
        // Return cached balance data
        const cached = this.getFallbackData('balances');
        if (cached) {
          return {
            ...cached.data,
            isStale: cached.isStale,
            lastUpdated: cached.timestamp,
            warning: 'Balance data may be outdated'
          };
        }
        return {
          balances: [],
          warning: 'Balance data temporarily unavailable',
          isStale: true
        };
      }
    });

    // Real-time data capability
    this.registerDegradationRule(ServiceCapability.REAL_TIME_DATA, {
      capability: ServiceCapability.REAL_TIME_DATA,
      requiredServices: ['exchange-connector'],
      minHealthyServices: 1,
      priority: 5,
      degradedFunction: async () => {
        // Return cached market data
        const cached = this.getFallbackData('market_data');
        if (cached) {
          return {
            ...cached.data,
            isStale: true,
            warning: 'Market data may be outdated'
          };
        }
        return {
          prices: {},
          warning: 'Real-time data temporarily unavailable',
          isStale: true
        };
      }
    });
  }
}