/**
 * System Recovery Service
 * Coordinates comprehensive error handling and recovery across all system components
 */

import { ErrorHandler, ApplicationError, ErrorCategory, ErrorSeverity, RecoveryStrategy } from '../utils/ErrorHandler';
import { StateRecoveryManager, RecoveryResult } from '../utils/StateRecoveryManager';
import { GracefulDegradationManager, DegradationStatus, ServiceCapability } from '../utils/GracefulDegradationManager';
import { AuditService } from './AuditService';
import { TradingEngine } from './TradingEngine';
import { PortfolioService } from './PortfolioService';
import { ResilienceManager } from './ResilienceManager';
import { SecurityManager } from '../security/SecurityManager';
import { ConnectorStatus } from '../models/ConnectorStatus';

export interface SystemComponent {
  name: string;
  instance: any;
  isEssential: boolean;
  dependencies: string[];
}

export interface SystemHealthReport {
  overallHealth: 'healthy' | 'degraded' | 'critical' | 'offline';
  componentHealth: Map<string, 'healthy' | 'degraded' | 'offline'>;
  degradationStatus: DegradationStatus;
  availableCapabilities: ServiceCapability[];
  recommendations: string[];
  lastCheck: Date;
  errorSummary: {
    totalErrors: number;
    criticalErrors: number;
    recentErrors: ApplicationError[];
  };
}

export interface RecoveryPlan {
  id: string;
  description: string;
  steps: RecoveryStep[];
  estimatedDuration: number;
  riskLevel: 'low' | 'medium' | 'high';
  prerequisites: string[];
}

export interface RecoveryStep {
  id: string;
  description: string;
  action: () => Promise<void>;
  rollbackAction?: () => Promise<void>;
  timeout: number;
  isOptional: boolean;
}

export interface RecoveryExecution {
  planId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  completedSteps: string[];
  failedSteps: string[];
  errors: ApplicationError[];
}

/**
 * Coordinates system-wide error handling and recovery
 */
export class SystemRecoveryService {
  private components: Map<string, SystemComponent> = new Map();
  private errorHandler: ErrorHandler;
  private stateRecoveryManager: StateRecoveryManager;
  private degradationManager: GracefulDegradationManager;
  private auditService: AuditService;
  private recoveryPlans: Map<string, RecoveryPlan> = new Map();
  private activeRecovery: RecoveryExecution | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthReport: SystemHealthReport | null = null;

  constructor(
    auditService: AuditService,
    errorHandler?: ErrorHandler,
    stateRecoveryManager?: StateRecoveryManager,
    degradationManager?: GracefulDegradationManager
  ) {
    this.auditService = auditService;
    this.errorHandler = errorHandler || new ErrorHandler();
    this.stateRecoveryManager = stateRecoveryManager || new StateRecoveryManager(auditService);
    this.degradationManager = degradationManager || new GracefulDegradationManager(auditService);
    
    this.initializeDefaultRecoveryPlans();
    this.startHealthMonitoring();
  }

  /**
   * Registers a system component for monitoring and recovery
   */
  registerComponent(component: SystemComponent): void {
    this.components.set(component.name, component);
    
    // Log component registration
    this.auditService.logSecurityEvent('COMPONENT_REGISTERED', {
      componentName: component.name,
      isEssential: component.isEssential,
      dependencies: component.dependencies,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Performs comprehensive system health check
   */
  async performSystemHealthCheck(): Promise<SystemHealthReport> {
    const startTime = Date.now();
    const componentHealth = new Map<string, 'healthy' | 'degraded' | 'offline'>();
    const recentErrors: ApplicationError[] = [];
    let criticalErrors = 0;

    // Check each component
    for (const [name, component] of this.components) {
      try {
        const health = await this.checkComponentHealth(component);
        componentHealth.set(name, health);
        
        if (health === 'offline' && component.isEssential) {
          criticalErrors++;
        }
      } catch (error) {
        componentHealth.set(name, 'offline');
        const appError = new ApplicationError(
          `Health check failed for ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'HEALTH_CHECK_FAILED',
          ErrorCategory.SYSTEM,
          ErrorSeverity.HIGH,
          {
            operation: 'performSystemHealthCheck',
            component: 'SystemRecoveryService',
            timestamp: new Date()
          },
          { originalError: error instanceof Error ? error : undefined }
        );
        recentErrors.push(appError);
        
        if (component.isEssential) {
          criticalErrors++;
        }
      }
    }

    // Get degradation status
    const degradationStatus = this.degradationManager.getDegradationStatus();
    
    // Determine overall health
    const healthyComponents = Array.from(componentHealth.values()).filter(h => h === 'healthy').length;
    const totalComponents = componentHealth.size;
    const healthyPercentage = totalComponents > 0 ? healthyComponents / totalComponents : 1;

    let overallHealth: 'healthy' | 'degraded' | 'critical' | 'offline';
    if (criticalErrors > 0) {
      overallHealth = 'critical';
    } else if (healthyPercentage >= 0.8) {
      overallHealth = 'healthy';
    } else if (healthyPercentage >= 0.5) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'offline';
    }

    // Get error metrics
    const errorMetrics = this.errorHandler.getErrorMetrics();
    const totalErrors = Array.from(errorMetrics.values()).reduce((sum, metric) => sum + metric.count, 0);

    // Generate recommendations
    const recommendations = this.generateHealthRecommendations(
      componentHealth,
      degradationStatus,
      overallHealth
    );

    const report: SystemHealthReport = {
      overallHealth,
      componentHealth,
      degradationStatus,
      availableCapabilities: degradationStatus.availableCapabilities,
      recommendations,
      lastCheck: new Date(),
      errorSummary: {
        totalErrors,
        criticalErrors,
        recentErrors: recentErrors.slice(0, 10) // Last 10 errors
      }
    };

    this.lastHealthReport = report;

    // Log health check completion
    this.auditService.logSecurityEvent('SYSTEM_HEALTH_CHECK_COMPLETED', {
      overallHealth,
      healthyComponents,
      totalComponents,
      criticalErrors,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

    return report;
  }

  /**
   * Executes automatic recovery based on system state
   */
  async executeAutoRecovery(): Promise<RecoveryExecution> {
    if (this.activeRecovery) {
      throw new ApplicationError(
        'Recovery already in progress',
        'RECOVERY_IN_PROGRESS',
        ErrorCategory.SYSTEM,
        ErrorSeverity.MEDIUM,
        {
          operation: 'executeAutoRecovery',
          component: 'SystemRecoveryService',
          timestamp: new Date()
        }
      );
    }

    const healthReport = await this.performSystemHealthCheck();
    const recoveryPlan = this.selectRecoveryPlan(healthReport);

    if (!recoveryPlan) {
      throw new ApplicationError(
        'No suitable recovery plan found',
        'NO_RECOVERY_PLAN',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: 'executeAutoRecovery',
          component: 'SystemRecoveryService',
          timestamp: new Date()
        }
      );
    }

    return this.executeRecoveryPlan(recoveryPlan);
  }

  /**
   * Executes a specific recovery plan
   */
  async executeRecoveryPlan(plan: RecoveryPlan): Promise<RecoveryExecution> {
    const execution: RecoveryExecution = {
      planId: plan.id,
      startTime: new Date(),
      status: 'running',
      completedSteps: [],
      failedSteps: [],
      errors: []
    };

    this.activeRecovery = execution;

    // Log recovery start
    this.auditService.logSecurityEvent('RECOVERY_EXECUTION_STARTED', {
      planId: plan.id,
      description: plan.description,
      stepCount: plan.steps.length,
      riskLevel: plan.riskLevel,
      timestamp: new Date().toISOString()
    });

    try {
      // Create system snapshot before recovery
      const components = new Map();
      for (const [name, component] of this.components) {
        components.set(name, component.instance);
      }
      
      const snapshotId = await this.stateRecoveryManager.createStateSnapshot(components, {
        description: `Pre-recovery snapshot for plan ${plan.id}`,
        recoveryPlan: plan.id
      });

      const recoveryPointId = await this.stateRecoveryManager.createRecoveryPoint(
        snapshotId,
        `Recovery point before executing plan ${plan.id}`
      );

      // Execute recovery steps
      for (const step of plan.steps) {
        try {
          await this.executeRecoveryStep(step, execution);
          execution.completedSteps.push(step.id);
        } catch (error) {
          execution.failedSteps.push(step.id);
          const appError = new ApplicationError(
            `Recovery step ${step.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            'RECOVERY_STEP_FAILED',
            ErrorCategory.SYSTEM,
            ErrorSeverity.HIGH,
            {
              operation: 'executeRecoveryPlan',
              component: 'SystemRecoveryService',
              timestamp: new Date()
            },
            { originalError: error instanceof Error ? error : undefined }
          );
          execution.errors.push(appError);

          // If step is not optional, consider recovery failed
          if (!step.isOptional) {
            execution.status = 'failed';
            break;
          }
        }
      }

      // Determine final status
      if (execution.status === 'running') {
        execution.status = execution.failedSteps.length > 0 ? 'completed' : 'completed';
      }

      execution.endTime = new Date();

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      
      const appError = new ApplicationError(
        `Recovery plan execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RECOVERY_PLAN_FAILED',
        ErrorCategory.SYSTEM,
        ErrorSeverity.CRITICAL,
        {
          operation: 'executeRecoveryPlan',
          component: 'SystemRecoveryService',
          timestamp: new Date()
        },
        { originalError: error instanceof Error ? error : undefined }
      );
      execution.errors.push(appError);
    } finally {
      this.activeRecovery = null;

      // Log recovery completion
      this.auditService.logSecurityEvent('RECOVERY_EXECUTION_COMPLETED', {
        planId: plan.id,
        status: execution.status,
        completedSteps: execution.completedSteps.length,
        failedSteps: execution.failedSteps.length,
        duration: execution.endTime ? execution.endTime.getTime() - execution.startTime.getTime() : 0,
        timestamp: new Date().toISOString()
      });
    }

    return execution;
  }

  /**
   * Gets current system status
   */
  async getSystemStatus(): Promise<{
    health: SystemHealthReport;
    activeRecovery: RecoveryExecution | null;
    availablePlans: RecoveryPlan[];
  }> {
    const health = this.lastHealthReport || await this.performSystemHealthCheck();
    
    return {
      health,
      activeRecovery: this.activeRecovery,
      availablePlans: Array.from(this.recoveryPlans.values())
    };
  }

  /**
   * Cancels active recovery execution
   */
  async cancelRecovery(): Promise<void> {
    if (!this.activeRecovery) {
      throw new ApplicationError(
        'No active recovery to cancel',
        'NO_ACTIVE_RECOVERY',
        ErrorCategory.SYSTEM,
        ErrorSeverity.LOW,
        {
          operation: 'cancelRecovery',
          component: 'SystemRecoveryService',
          timestamp: new Date()
        }
      );
    }

    this.activeRecovery.status = 'cancelled';
    this.activeRecovery.endTime = new Date();
    
    // Log cancellation
    this.auditService.logSecurityEvent('RECOVERY_CANCELLED', {
      planId: this.activeRecovery.planId,
      completedSteps: this.activeRecovery.completedSteps.length,
      timestamp: new Date().toISOString()
    });

    this.activeRecovery = null;
  }

  /**
   * Checks health of a specific component
   */
  private async checkComponentHealth(component: SystemComponent): Promise<'healthy' | 'degraded' | 'offline'> {
    try {
      // Try different health check methods
      if (typeof component.instance.healthCheck === 'function') {
        const isHealthy = await component.instance.healthCheck();
        return isHealthy ? 'healthy' : 'degraded';
      }
      
      if (typeof component.instance.getStatus === 'function') {
        const status: ConnectorStatus = component.instance.getStatus();
        switch (status.status) {
          case 'healthy': return 'healthy';
          case 'degraded': return 'degraded';
          case 'offline': return 'offline';
          default: return 'offline';
        }
      }

      // If no health check method, assume healthy if instance exists
      return component.instance ? 'healthy' : 'offline';
    } catch (error) {
      return 'offline';
    }
  }

  /**
   * Selects appropriate recovery plan based on system health
   */
  private selectRecoveryPlan(healthReport: SystemHealthReport): RecoveryPlan | null {
    // Select plan based on overall health and specific issues
    switch (healthReport.overallHealth) {
      case 'critical':
        return this.recoveryPlans.get('critical_recovery');
      case 'degraded':
        return this.recoveryPlans.get('degraded_recovery');
      case 'offline':
        return this.recoveryPlans.get('full_recovery');
      default:
        return null; // System is healthy, no recovery needed
    }
  }

  /**
   * Executes a single recovery step
   */
  private async executeRecoveryStep(step: RecoveryStep, execution: RecoveryExecution): Promise<void> {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Step ${step.id} timed out after ${step.timeout}ms`)), step.timeout);
    });

    try {
      await Promise.race([step.action(), timeout]);
    } catch (error) {
      // If step has rollback action, try to execute it
      if (step.rollbackAction) {
        try {
          await step.rollbackAction();
        } catch (rollbackError) {
          // Log rollback failure but don't throw
          this.auditService.logSecurityEvent('RECOVERY_STEP_ROLLBACK_FAILED', {
            stepId: step.id,
            error: rollbackError instanceof Error ? rollbackError.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      }
      throw error;
    }
  }

  /**
   * Generates health recommendations
   */
  private generateHealthRecommendations(
    componentHealth: Map<string, 'healthy' | 'degraded' | 'offline'>,
    degradationStatus: DegradationStatus,
    overallHealth: string
  ): string[] {
    const recommendations: string[] = [];

    // Component-specific recommendations
    for (const [name, health] of componentHealth) {
      if (health === 'offline') {
        recommendations.push(`Restart or reconfigure ${name} component`);
      } else if (health === 'degraded') {
        recommendations.push(`Check ${name} component configuration and connectivity`);
      }
    }

    // Capability-specific recommendations
    if (!degradationStatus.availableCapabilities.includes(ServiceCapability.TRADING)) {
      recommendations.push('Trading is unavailable - check exchange connectivity');
    }

    if (!degradationStatus.availableCapabilities.includes(ServiceCapability.PORTFOLIO_VIEW)) {
      recommendations.push('Portfolio data may be stale - refresh venue connections');
    }

    // Overall system recommendations
    if (overallHealth === 'critical') {
      recommendations.push('System is in critical state - consider manual intervention');
      recommendations.push('Execute emergency recovery procedures');
    } else if (overallHealth === 'degraded') {
      recommendations.push('System is degraded - monitor closely and consider recovery');
    }

    return recommendations;
  }

  /**
   * Starts continuous health monitoring
   */
  private startHealthMonitoring(): void {
    // Perform health check every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performSystemHealthCheck();
      } catch (error) {
        // Log error but don't throw
        this.auditService.logSecurityEvent('HEALTH_MONITORING_ERROR', {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }, 30000);
  }

  /**
   * Stops health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Initializes default recovery plans
   */
  private initializeDefaultRecoveryPlans(): void {
    // Critical recovery plan
    this.recoveryPlans.set('critical_recovery', {
      id: 'critical_recovery',
      description: 'Emergency recovery for critical system failures',
      estimatedDuration: 300000, // 5 minutes
      riskLevel: 'high',
      prerequisites: [],
      steps: [
        {
          id: 'stop_trading',
          description: 'Stop all trading operations',
          action: async () => {
            // Implementation would stop trading
          },
          timeout: 10000,
          isOptional: false
        },
        {
          id: 'restart_connectors',
          description: 'Restart all exchange connectors',
          action: async () => {
            // Implementation would restart connectors
          },
          timeout: 30000,
          isOptional: false
        },
        {
          id: 'verify_system',
          description: 'Verify system integrity',
          action: async () => {
            await this.performSystemHealthCheck();
          },
          timeout: 15000,
          isOptional: false
        }
      ]
    });

    // Degraded recovery plan
    this.recoveryPlans.set('degraded_recovery', {
      id: 'degraded_recovery',
      description: 'Recovery for degraded system performance',
      estimatedDuration: 120000, // 2 minutes
      riskLevel: 'medium',
      prerequisites: [],
      steps: [
        {
          id: 'refresh_connections',
          description: 'Refresh all venue connections',
          action: async () => {
            // Implementation would refresh connections
          },
          timeout: 20000,
          isOptional: false
        },
        {
          id: 'clear_caches',
          description: 'Clear stale caches',
          action: async () => {
            // Implementation would clear caches
          },
          timeout: 5000,
          isOptional: true
        }
      ]
    });
  }
}