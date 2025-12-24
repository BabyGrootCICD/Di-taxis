/**
 * Monitoring Service for system metrics collection and alerting
 * Implements resource utilization tracking, status change notifications, and threshold-based alerting
 */

import { ConnectorStatus, ConnectorHealthStatus } from '../models/ConnectorStatus';
import { AuditService } from './AuditService';

export interface SystemMetrics {
  timestamp: Date;
  cpuUsage: number; // percentage
  memoryUsage: number; // percentage
  diskUsage: number; // percentage
  networkLatency: number; // milliseconds
  errorRate: number; // percentage
  requestsPerSecond: number;
}

export interface ResourceThresholds {
  cpuWarning: number; // percentage
  cpuCritical: number; // percentage
  memoryWarning: number; // percentage
  memoryCritical: number; // percentage
  diskWarning: number; // percentage
  diskCritical: number; // percentage
  latencyWarning: number; // milliseconds
  latencyCritical: number; // milliseconds
  errorRateWarning: number; // percentage
  errorRateCritical: number; // percentage
}

export interface Alert {
  id: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
  type: 'resource' | 'connector_status' | 'system';
  message: string;
  details: Record<string, any>;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface StatusChangeNotification {
  connectorId: string;
  connectorName: string;
  previousStatus: ConnectorHealthStatus;
  currentStatus: ConnectorHealthStatus;
  timestamp: Date;
  details?: string;
}

export type AlertHandler = (alert: Alert) => Promise<void>;
export type StatusChangeHandler = (notification: StatusChangeNotification) => Promise<void>;

/**
 * Default resource thresholds
 */
const DEFAULT_THRESHOLDS: ResourceThresholds = {
  cpuWarning: 70,
  cpuCritical: 90,
  memoryWarning: 80,
  memoryCritical: 95,
  diskWarning: 85,
  diskCritical: 95,
  latencyWarning: 1000,
  latencyCritical: 5000,
  errorRateWarning: 5,
  errorRateCritical: 10
};

/**
 * Monitoring Service class for system metrics and alerting
 */
export class MonitoringService {
  private auditService: AuditService;
  private thresholds: ResourceThresholds;
  private alertHandlers: AlertHandler[] = [];
  private statusChangeHandlers: StatusChangeHandler[] = [];
  private connectorStatuses: Map<string, ConnectorStatus> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private metricsHistory: SystemMetrics[] = [];
  private metricsCollectionInterval?: NodeJS.Timeout;
  private readonly maxHistorySize = 1000; // Keep last 1000 metrics entries

  constructor(auditService: AuditService, thresholds?: Partial<ResourceThresholds>) {
    this.auditService = auditService;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Start monitoring with specified collection interval
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.metricsCollectionInterval) {
      this.stopMonitoring();
    }

    this.metricsCollectionInterval = setInterval(async () => {
      try {
        const metrics = await this.collectSystemMetrics();
        this.metricsHistory.push(metrics);
        
        // Trim history to max size
        if (this.metricsHistory.length > this.maxHistorySize) {
          this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
        }
        
        // Check for threshold breaches
        await this.checkResourceThresholds(metrics);
      } catch (error) {
        await this.auditService.logSecurityEvent('MONITORING_ERROR', {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }, intervalMs);

    this.auditService.logSecurityEvent('MONITORING_STARTED', {
      intervalMs,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
      this.metricsCollectionInterval = undefined;
    }

    this.auditService.logSecurityEvent('MONITORING_STOPPED', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Collect current system metrics
   */
  async collectSystemMetrics(): Promise<SystemMetrics> {
    const timestamp = new Date();
    
    // In a real implementation, these would use actual system monitoring APIs
    // For now, we'll simulate metrics collection
    const metrics: SystemMetrics = {
      timestamp,
      cpuUsage: this.simulateMetric(20, 100), // 20-100% CPU usage
      memoryUsage: this.simulateMetric(30, 95), // 30-95% memory usage
      diskUsage: this.simulateMetric(40, 90), // 40-90% disk usage
      networkLatency: this.simulateMetric(10, 2000), // 10-2000ms latency
      errorRate: this.simulateMetric(0, 15), // 0-15% error rate
      requestsPerSecond: this.simulateMetric(10, 1000) // 10-1000 RPS
    };

    return metrics;
  }

  /**
   * Update connector status and trigger notifications if changed
   */
  async updateConnectorStatus(status: ConnectorStatus): Promise<void> {
    const previousStatus = this.connectorStatuses.get(status.connectorId);
    this.connectorStatuses.set(status.connectorId, status);

    // Check if status changed
    if (previousStatus && previousStatus.status !== status.status) {
      const notification: StatusChangeNotification = {
        connectorId: status.connectorId,
        connectorName: status.name,
        previousStatus: previousStatus.status,
        currentStatus: status.status,
        timestamp: new Date(),
        details: `Status changed from ${previousStatus.status} to ${status.status}`
      };

      // Trigger status change handlers
      for (const handler of this.statusChangeHandlers) {
        try {
          await handler(notification);
        } catch (error) {
          await this.auditService.logSecurityEvent('STATUS_CHANGE_HANDLER_ERROR', {
            connectorId: status.connectorId,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          });
        }
      }

      // Log status change
      await this.auditService.logSecurityEvent('CONNECTOR_STATUS_CHANGED', {
        connectorId: status.connectorId,
        connectorName: status.name,
        previousStatus: previousStatus.status,
        currentStatus: status.status,
        timestamp: new Date().toISOString()
      });

      // Create alert for critical status changes
      if (status.status === 'offline') {
        await this.createAlert({
          severity: 'critical',
          type: 'connector_status',
          message: `Connector ${status.name} went offline`,
          details: {
            connectorId: status.connectorId,
            connectorName: status.name,
            previousStatus: previousStatus.status,
            currentStatus: status.status
          }
        });
      } else if (status.status === 'degraded') {
        await this.createAlert({
          severity: 'warning',
          type: 'connector_status',
          message: `Connector ${status.name} is degraded`,
          details: {
            connectorId: status.connectorId,
            connectorName: status.name,
            previousStatus: previousStatus.status,
            currentStatus: status.status,
            errorRate: status.errorRate,
            latency: status.latency
          }
        });
      }
    }
  }

  /**
   * Register alert handler
   */
  registerAlertHandler(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  /**
   * Register status change handler
   */
  registerStatusChangeHandler(handler: StatusChangeHandler): void {
    this.statusChangeHandlers.push(handler);
  }

  /**
   * Get current system metrics
   */
  getCurrentMetrics(): SystemMetrics | undefined {
    return this.metricsHistory[this.metricsHistory.length - 1];
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit?: number): SystemMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Get all alerts (including resolved)
   */
  getAllAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      
      await this.auditService.logSecurityEvent('ALERT_RESOLVED', {
        alertId,
        alertType: alert.type,
        severity: alert.severity,
        resolvedAt: alert.resolvedAt.toISOString()
      });
      
      return true;
    }
    return false;
  }

  /**
   * Update resource thresholds
   */
  updateThresholds(newThresholds: Partial<ResourceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    
    this.auditService.logSecurityEvent('THRESHOLDS_UPDATED', {
      newThresholds,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get current thresholds
   */
  getThresholds(): ResourceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Check resource thresholds and create alerts if breached
   */
  private async checkResourceThresholds(metrics: SystemMetrics): Promise<void> {
    const checks = [
      { metric: 'cpuUsage', value: metrics.cpuUsage, warning: this.thresholds.cpuWarning, critical: this.thresholds.cpuCritical },
      { metric: 'memoryUsage', value: metrics.memoryUsage, warning: this.thresholds.memoryWarning, critical: this.thresholds.memoryCritical },
      { metric: 'diskUsage', value: metrics.diskUsage, warning: this.thresholds.diskWarning, critical: this.thresholds.diskCritical },
      { metric: 'networkLatency', value: metrics.networkLatency, warning: this.thresholds.latencyWarning, critical: this.thresholds.latencyCritical },
      { metric: 'errorRate', value: metrics.errorRate, warning: this.thresholds.errorRateWarning, critical: this.thresholds.errorRateCritical }
    ];

    for (const check of checks) {
      const alertKey = `resource_${check.metric}`;
      const existingAlert = Array.from(this.activeAlerts.values())
        .find(alert => alert.type === 'resource' && alert.details.metric === check.metric && !alert.resolved);

      if (check.value >= check.critical) {
        if (!existingAlert || existingAlert.severity !== 'critical') {
          // Resolve existing warning alert if exists
          if (existingAlert && existingAlert.severity === 'warning') {
            await this.resolveAlert(existingAlert.id);
          }
          
          await this.createAlert({
            severity: 'critical',
            type: 'resource',
            message: `Critical ${check.metric} threshold breached: ${check.value}%`,
            details: {
              metric: check.metric,
              value: check.value,
              threshold: check.critical,
              unit: check.metric === 'networkLatency' ? 'ms' : '%'
            }
          });
        }
      } else if (check.value >= check.warning) {
        if (!existingAlert) {
          await this.createAlert({
            severity: 'warning',
            type: 'resource',
            message: `Warning ${check.metric} threshold breached: ${check.value}%`,
            details: {
              metric: check.metric,
              value: check.value,
              threshold: check.warning,
              unit: check.metric === 'networkLatency' ? 'ms' : '%'
            }
          });
        }
      } else {
        // Value is below warning threshold, resolve any existing alerts
        if (existingAlert) {
          await this.resolveAlert(existingAlert.id);
        }
      }
    }
  }

  /**
   * Create and trigger alert
   */
  private async createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'resolved'>): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      timestamp: new Date(),
      resolved: false,
      ...alertData
    };

    this.activeAlerts.set(alert.id, alert);

    // Trigger alert handlers
    for (const handler of this.alertHandlers) {
      try {
        await handler(alert);
      } catch (error) {
        await this.auditService.logSecurityEvent('ALERT_HANDLER_ERROR', {
          alertId: alert.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Log alert creation
    await this.auditService.logSecurityEvent('ALERT_CREATED', {
      alertId: alert.id,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      timestamp: alert.timestamp.toISOString()
    });

    return alert;
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simulate metric value for testing purposes
   */
  private simulateMetric(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get connector statuses
   */
  getConnectorStatuses(): ConnectorStatus[] {
    return Array.from(this.connectorStatuses.values());
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.stopMonitoring();
    this.alertHandlers.length = 0;
    this.statusChangeHandlers.length = 0;
    this.activeAlerts.clear();
    this.connectorStatuses.clear();
    this.metricsHistory.length = 0;

    await this.auditService.logSecurityEvent('MONITORING_CLEANUP', {
      timestamp: new Date().toISOString()
    });
  }
}