/**
 * Connector status and health monitoring models
 */

export type ConnectorType = 'exchange' | 'onchain';
export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'offline';

export interface ConnectorStatus {
  connectorId: string;
  connectorType: ConnectorType;
  name: string;
  status: ConnectorHealthStatus;
  lastHealthCheck: Date;
  latency: number;
  errorRate: number;
  capabilities: string[];
}