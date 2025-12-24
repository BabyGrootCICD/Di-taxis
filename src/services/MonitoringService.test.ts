/**
 * Tests for MonitoringService
 * Includes property-based tests for status change notifications and resource monitoring
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { MonitoringService, Alert, StatusChangeNotification, ResourceThresholds } from './MonitoringService';
import { AuditService } from './AuditService';
import { ConnectorStatus, ConnectorHealthStatus } from '../models/ConnectorStatus';

describe('MonitoringService', () => {
  let monitoringService: MonitoringService;
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService();
    monitoringService = new MonitoringService(auditService);
  });

  afterEach(async () => {
    await monitoringService.cleanup();
  });

  describe('Basic functionality', () => {
    it('should start and stop monitoring', () => {
      expect(() => monitoringService.startMonitoring(1000)).not.toThrow();
      expect(() => monitoringService.stopMonitoring()).not.toThrow();
    });

    it('should collect system metrics', async () => {
      const metrics = await monitoringService.collectSystemMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(typeof metrics.cpuUsage).toBe('number');
      expect(typeof metrics.memoryUsage).toBe('number');
      expect(typeof metrics.diskUsage).toBe('number');
      expect(typeof metrics.networkLatency).toBe('number');
      expect(typeof metrics.errorRate).toBe('number');
      expect(typeof metrics.requestsPerSecond).toBe('number');
    });

    it('should update and retrieve thresholds', () => {
      const newThresholds: Partial<ResourceThresholds> = {
        cpuWarning: 60,
        memoryWarning: 70
      };
      
      monitoringService.updateThresholds(newThresholds);
      const currentThresholds = monitoringService.getThresholds();
      
      expect(currentThresholds.cpuWarning).toBe(60);
      expect(currentThresholds.memoryWarning).toBe(70);
    });
  });

  describe('Property-based tests', () => {
    /**
     * **Feature: gold-router-app, Property 37: Status changes trigger notifications**
     * **Validates: Requirements 8.3**
     */
    it('should trigger notifications for any connector status change', async () => {
      await fc.assert(fc.asyncProperty(
        // Generate connector status data with non-empty strings
        fc.record({
          connectorId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          connectorType: fc.constantFrom('exchange', 'onchain'),
          name: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          status: fc.constantFrom('healthy', 'degraded', 'offline'),
          lastHealthCheck: fc.date(),
          latency: fc.integer({ min: 0, max: 10000 }),
          errorRate: fc.float({ min: 0, max: 100 }),
          capabilities: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 5 })
        }),
        // Generate a different status for the change
        fc.constantFrom('healthy', 'degraded', 'offline'),
        
        async (initialStatus, newStatus) => {
          // Skip if status is the same (no change expected)
          if (initialStatus.status === newStatus) {
            return;
          }

          // Create a fresh monitoring service for each test to avoid state pollution
          const testAuditService = new AuditService();
          const testMonitoringService = new MonitoringService(testAuditService);
          
          const notifications: StatusChangeNotification[] = [];
          
          // Register handler to capture notifications
          testMonitoringService.registerStatusChangeHandler(async (notification) => {
            notifications.push(notification);
          });

          // Set initial status
          await testMonitoringService.updateConnectorStatus(initialStatus as ConnectorStatus);
          
          // Change status
          const updatedStatus: ConnectorStatus = {
            ...initialStatus as ConnectorStatus,
            status: newStatus as ConnectorHealthStatus
          };
          
          await testMonitoringService.updateConnectorStatus(updatedStatus);

          // Verify notification was triggered
          expect(notifications).toHaveLength(1);
          expect(notifications[0].connectorId).toBe(initialStatus.connectorId);
          expect(notifications[0].connectorName).toBe(initialStatus.name);
          expect(notifications[0].previousStatus).toBe(initialStatus.status);
          expect(notifications[0].currentStatus).toBe(newStatus);
          expect(notifications[0].timestamp).toBeInstanceOf(Date);
          
          await testMonitoringService.cleanup();
        }
      ), { numRuns: 100 });
    });

    /**
     * **Feature: gold-router-app, Property 39: Resource monitoring triggers alerts**
     * **Validates: Requirements 8.5**
     */
    it('should trigger alerts when any resource threshold is breached', async () => {
      await fc.assert(fc.asyncProperty(
        // Generate threshold configuration
        fc.record({
          cpuWarning: fc.integer({ min: 50, max: 80 }),
          cpuCritical: fc.integer({ min: 85, max: 95 }),
          memoryWarning: fc.integer({ min: 60, max: 85 }),
          memoryCritical: fc.integer({ min: 90, max: 98 }),
          diskWarning: fc.integer({ min: 70, max: 90 }),
          diskCritical: fc.integer({ min: 95, max: 99 }),
          latencyWarning: fc.integer({ min: 500, max: 2000 }),
          latencyCritical: fc.integer({ min: 3000, max: 8000 }),
          errorRateWarning: fc.integer({ min: 3, max: 8 }),
          errorRateCritical: fc.integer({ min: 10, max: 20 })
        }),
        // Generate metric values that exceed thresholds
        fc.constantFrom('cpu', 'memory', 'disk', 'latency', 'errorRate'),
        fc.constantFrom('warning', 'critical'),
        
        async (thresholds, metricType, severityLevel) => {
          // Ensure critical thresholds are higher than warning thresholds
          const validThresholds = {
            ...thresholds,
            cpuCritical: Math.max(thresholds.cpuCritical, thresholds.cpuWarning + 5),
            memoryCritical: Math.max(thresholds.memoryCritical, thresholds.memoryWarning + 5),
            diskCritical: Math.max(thresholds.diskCritical, thresholds.diskWarning + 5),
            latencyCritical: Math.max(thresholds.latencyCritical, thresholds.latencyWarning + 500),
            errorRateCritical: Math.max(thresholds.errorRateCritical, thresholds.errorRateWarning + 2)
          };

          // Create a fresh monitoring service for each test
          const testAuditService = new AuditService();
          const testMonitoringService = new MonitoringService(testAuditService);
          
          const alerts: Alert[] = [];
          
          // Register alert handler to capture alerts
          testMonitoringService.registerAlertHandler(async (alert) => {
            alerts.push(alert);
          });

          // Update thresholds
          testMonitoringService.updateThresholds(validThresholds);

          // Create metrics that breach the specified threshold
          const baseMetrics = {
            timestamp: new Date(),
            cpuUsage: 30,
            memoryUsage: 40,
            diskUsage: 50,
            networkLatency: 200,
            errorRate: 1,
            requestsPerSecond: 100
          };

          // Set the specific metric to breach the threshold
          let thresholdValue: number;
          let metricKey: string;
          switch (metricType) {
            case 'cpu':
              thresholdValue = severityLevel === 'critical' ? validThresholds.cpuCritical : validThresholds.cpuWarning;
              baseMetrics.cpuUsage = thresholdValue + 1;
              metricKey = 'cpuUsage';
              break;
            case 'memory':
              thresholdValue = severityLevel === 'critical' ? validThresholds.memoryCritical : validThresholds.memoryWarning;
              baseMetrics.memoryUsage = thresholdValue + 1;
              metricKey = 'memoryUsage';
              break;
            case 'disk':
              thresholdValue = severityLevel === 'critical' ? validThresholds.diskCritical : validThresholds.diskWarning;
              baseMetrics.diskUsage = thresholdValue + 1;
              metricKey = 'diskUsage';
              break;
            case 'latency':
              thresholdValue = severityLevel === 'critical' ? validThresholds.latencyCritical : validThresholds.latencyWarning;
              baseMetrics.networkLatency = thresholdValue + 1;
              metricKey = 'networkLatency';
              break;
            case 'errorRate':
              thresholdValue = severityLevel === 'critical' ? validThresholds.errorRateCritical : validThresholds.errorRateWarning;
              baseMetrics.errorRate = thresholdValue + 1;
              metricKey = 'errorRate';
              break;
            default:
              throw new Error(`Unknown metric type: ${metricType}`);
          }

          // Directly call the private method to check thresholds (simulate what happens during monitoring)
          await (testMonitoringService as any).checkResourceThresholds(baseMetrics);

          // Verify alert was triggered
          expect(alerts.length).toBeGreaterThan(0);
          
          const relevantAlert = alerts.find(alert => 
            alert.type === 'resource' && 
            alert.severity === severityLevel &&
            alert.details.metric === metricKey
          );
          
          expect(relevantAlert).toBeDefined();
          expect(relevantAlert!.severity).toBe(severityLevel);
          expect(relevantAlert!.type).toBe('resource');
          expect(relevantAlert!.timestamp).toBeInstanceOf(Date);
          expect(relevantAlert!.resolved).toBe(false);
          
          await testMonitoringService.cleanup();
        }
      ), { numRuns: 50 }); // Reduced runs due to complexity
    });
  });

  describe('Alert management', () => {
    it('should create and resolve alerts', async () => {
      // Create a fresh monitoring service for this test
      const testAuditService = new AuditService();
      const testMonitoringService = new MonitoringService(testAuditService);
      
      const alerts: Alert[] = [];
      
      testMonitoringService.registerAlertHandler(async (alert) => {
        alerts.push(alert);
      });

      // First set a healthy status
      const healthyStatus: ConnectorStatus = {
        connectorId: 'test-connector',
        connectorType: 'exchange',
        name: 'Test Exchange',
        status: 'healthy',
        lastHealthCheck: new Date(),
        latency: 100,
        errorRate: 0,
        capabilities: ['trading']
      };

      await testMonitoringService.updateConnectorStatus(healthyStatus);

      // Now create a connector status that will trigger an alert (status change)
      const offlineStatus: ConnectorStatus = {
        ...healthyStatus,
        status: 'offline',
        latency: 0,
        errorRate: 100
      };

      await testMonitoringService.updateConnectorStatus(offlineStatus);

      // Should have created an alert
      expect(alerts.length).toBeGreaterThan(0);
      
      const alert = alerts[0];
      expect(alert.severity).toBe('critical');
      expect(alert.type).toBe('connector_status');
      expect(alert.resolved).toBe(false);

      // Resolve the alert
      const resolved = await testMonitoringService.resolveAlert(alert.id);
      expect(resolved).toBe(true);
      expect(alert.resolved).toBe(true);
      expect(alert.resolvedAt).toBeInstanceOf(Date);
      
      await testMonitoringService.cleanup();
    });

    it('should track active and resolved alerts', async () => {
      // Create a fresh monitoring service for this test
      const testAuditService = new AuditService();
      const testMonitoringService = new MonitoringService(testAuditService);
      
      const alerts: Alert[] = [];
      
      testMonitoringService.registerAlertHandler(async (alert) => {
        alerts.push(alert);
      });

      // Create initial healthy statuses
      const initialStatuses: ConnectorStatus[] = [
        {
          connectorId: 'connector-1',
          connectorType: 'exchange',
          name: 'Exchange 1',
          status: 'healthy',
          lastHealthCheck: new Date(),
          latency: 100,
          errorRate: 0,
          capabilities: ['trading']
        },
        {
          connectorId: 'connector-2',
          connectorType: 'onchain',
          name: 'Chain Tracker',
          status: 'healthy',
          lastHealthCheck: new Date(),
          latency: 200,
          errorRate: 0,
          capabilities: ['tracking']
        }
      ];

      // Set initial healthy statuses
      for (const status of initialStatuses) {
        await testMonitoringService.updateConnectorStatus(status);
      }

      // Now create problematic statuses to trigger alerts
      const problemStatuses: ConnectorStatus[] = [
        {
          ...initialStatuses[0],
          status: 'offline',
          latency: 0,
          errorRate: 100
        },
        {
          ...initialStatuses[1],
          status: 'degraded',
          latency: 2000,
          errorRate: 15
        }
      ];

      for (const status of problemStatuses) {
        await testMonitoringService.updateConnectorStatus(status);
      }

      // Should have created alerts
      const activeAlerts = testMonitoringService.getActiveAlerts();
      expect(activeAlerts.length).toBe(2);

      // Resolve one alert
      await testMonitoringService.resolveAlert(activeAlerts[0].id);

      // Check active vs all alerts
      const stillActiveAlerts = testMonitoringService.getActiveAlerts();
      const allAlerts = testMonitoringService.getAllAlerts();
      
      expect(stillActiveAlerts.length).toBe(1);
      expect(allAlerts.length).toBe(2);
      
      await testMonitoringService.cleanup();
    });
  });

  describe('Metrics history', () => {
    it('should maintain metrics history', async () => {
      // Collect some metrics
      const metrics1 = await monitoringService.collectSystemMetrics();
      const metrics2 = await monitoringService.collectSystemMetrics();
      
      // Manually add to history (since we're not running the interval)
      monitoringService['metricsHistory'].push(metrics1, metrics2);
      
      const history = monitoringService.getMetricsHistory();
      expect(history.length).toBe(2);
      
      const current = monitoringService.getCurrentMetrics();
      expect(current).toBe(metrics2);
      
      const limited = monitoringService.getMetricsHistory(1);
      expect(limited.length).toBe(1);
      expect(limited[0]).toBe(metrics2);
    });
  });
});