/**
 * API Gateway for RESTful endpoints
 * Provides health monitoring, portfolio access, connector status, and audit log endpoints
 */

import { PortfolioService } from '../services/PortfolioService';
import { AuditService } from '../services/AuditService';
import { ConnectorStatus } from '../models/ConnectorStatus';

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  user?: { id: string; permissions: string[] };
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  requestId: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'offline';
  timestamp: Date;
  components: Record<string, ComponentHealth>;
  uptime: number;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'offline';
  lastCheck: Date;
  responseTime?: number;
  errorRate?: number;
}

export interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  errorRate: number;
  uptime: number;
  timestamp: Date;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * API Gateway class providing RESTful endpoints
 */
export class ApiGateway {
  private portfolioService: PortfolioService;
  private auditService: AuditService;
  private connectors: Map<string, any> = new Map();
  private startTime: Date = new Date();
  private requestCount: number = 0;
  private totalResponseTime: number = 0;
  private errorCount: number = 0;
  private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();
  private rateLimitConfig: RateLimitConfig = { windowMs: 60000, maxRequests: 100 }; // 100 requests per minute

  constructor(portfolioService: PortfolioService, auditService: AuditService) {
    this.portfolioService = portfolioService;
    this.auditService = auditService;
  }

  /**
   * Register a connector for status monitoring
   */
  registerConnector(id: string, connector: any): void {
    this.connectors.set(id, connector);
  }

  /**
   * Main request handler
   */
  async handleRequest(request: ApiRequest): Promise<ApiResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      // Rate limiting check
      const rateLimitResult = this.checkRateLimit(this.getClientId(request));
      if (!rateLimitResult.allowed) {
        return this.createErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', requestId);
      }

      // Authentication and authorization
      const authResult = this.authenticate(request);
      if (!authResult.success) {
        return this.createErrorResponse(401, 'UNAUTHORIZED', authResult.message || 'Authentication failed', requestId);
      }

      // Log request
      this.auditService.logSecurityEvent('API_REQUEST', {
        method: request.method,
        path: request.path,
        userAgent: request.headers['user-agent'] || 'unknown',
        clientIp: request.headers['x-forwarded-for'] || 'unknown'
      }, request.user?.id);

      // Route request
      const response = await this.routeRequest(request, requestId);
      
      // Track metrics
      const responseTime = Date.now() - startTime;
      this.trackMetrics(responseTime, response.statusCode >= 400);
      
      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.trackMetrics(responseTime, true);
      
      return this.createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error', requestId, error);
    }
  }

  /**
   * Route requests to appropriate handlers
   */
  private async routeRequest(request: ApiRequest, requestId: string): Promise<ApiResponse> {
    const { method, path } = request;

    // Health endpoint
    if (method === 'GET' && path === '/health') {
      return this.handleHealthCheck(requestId);
    }

    // Portfolio endpoint
    if (method === 'GET' && path === '/portfolio') {
      return this.handleGetPortfolio(request, requestId);
    }

    // Connectors endpoint
    if (method === 'GET' && path === '/connectors') {
      return this.handleGetConnectors(requestId);
    }

    // Audit logs endpoint
    if (method === 'GET' && path === '/audit/logs') {
      return this.handleGetAuditLogs(request, requestId);
    }

    // Metrics endpoint
    if (method === 'GET' && path === '/metrics') {
      return this.handleGetMetrics(requestId);
    }

    return this.createErrorResponse(404, 'NOT_FOUND', 'Endpoint not found', requestId);
  }

  /**
   * Handle health check endpoint
   */
  private async handleHealthCheck(requestId: string): Promise<ApiResponse> {
    const components: Record<string, ComponentHealth> = {};
    let overallStatus: 'healthy' | 'degraded' | 'offline' = 'healthy';

    // Check portfolio service health
    try {
      const startTime = Date.now();
      const portfolio = await this.portfolioService.getPortfolio();
      const responseTime = Date.now() - startTime;
      
      components.portfolio = {
        status: portfolio.status === 'healthy' ? 'healthy' : 'degraded',
        lastCheck: new Date(),
        responseTime
      };
      
      // Only consider portfolio status if we have connectors registered
      // If no connectors are registered, portfolio will be empty but that's not necessarily "offline"
      if (this.connectors.size > 0) {
        if (portfolio.status === 'offline') {
          overallStatus = 'offline';
        } else if (portfolio.status === 'degraded' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    } catch (error) {
      components.portfolio = {
        status: 'offline',
        lastCheck: new Date()
      };
      // Only set overall status to offline if we have connectors that should be working
      if (this.connectors.size > 0) {
        overallStatus = 'offline';
      }
    }

    // Check connector health
    for (const [connectorId, connector] of this.connectors) {
      try {
        const status = connector.getStatus();
        components[connectorId] = {
          status: status.status,
          lastCheck: status.lastHealthCheck,
          responseTime: status.latency,
          errorRate: status.errorRate
        };
        
        if (status.status === 'offline') {
          overallStatus = 'offline';
        } else if (status.status === 'degraded' && overallStatus !== 'offline') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        components[connectorId] = {
          status: 'offline',
          lastCheck: new Date()
        };
        overallStatus = 'offline';
      }
    }

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date(),
      components,
      uptime: Date.now() - this.startTime.getTime()
    };

    return {
      statusCode: overallStatus === 'offline' ? 503 : 200,
      headers: { 'Content-Type': 'application/json' },
      body: healthStatus
    };
  }

  /**
   * Handle get portfolio endpoint
   */
  private async handleGetPortfolio(request: ApiRequest, requestId: string): Promise<ApiResponse> {
    try {
      const forceRefresh = request.query?.refresh === 'true';
      const portfolio = await this.portfolioService.getPortfolio({ forceRefresh });
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: portfolio
      };
    } catch (error) {
      return this.createErrorResponse(500, 'PORTFOLIO_ERROR', 'Failed to retrieve portfolio', requestId, error);
    }
  }

  /**
   * Handle get connectors endpoint
   */
  private async handleGetConnectors(requestId: string): Promise<ApiResponse> {
    try {
      const connectorStatuses: Record<string, ConnectorStatus> = {};
      
      for (const [connectorId, connector] of this.connectors) {
        try {
          connectorStatuses[connectorId] = connector.getStatus();
        } catch (error) {
          connectorStatuses[connectorId] = {
            connectorId,
            connectorType: 'exchange' as const,
            name: connectorId,
            status: 'offline',
            lastHealthCheck: new Date(),
            latency: 0,
            errorRate: 1.0,
            capabilities: []
          };
        }
      }
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { connectors: connectorStatuses }
      };
    } catch (error) {
      return this.createErrorResponse(500, 'CONNECTORS_ERROR', 'Failed to retrieve connector status', requestId, error);
    }
  }

  /**
   * Handle get audit logs endpoint
   */
  private async handleGetAuditLogs(request: ApiRequest, requestId: string): Promise<ApiResponse> {
    try {
      // Parse date filters from query parameters
      const startDate = request.query?.startDate ? new Date(request.query.startDate) : undefined;
      const endDate = request.query?.endDate ? new Date(request.query.endDate) : undefined;
      
      // Validate dates
      if (startDate && isNaN(startDate.getTime())) {
        return this.createErrorResponse(400, 'INVALID_DATE', 'Invalid startDate format', requestId);
      }
      if (endDate && isNaN(endDate.getTime())) {
        return this.createErrorResponse(400, 'INVALID_DATE', 'Invalid endDate format', requestId);
      }
      
      const auditLogs = this.auditService.exportAuditLog(startDate, endDate);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { logs: auditLogs, count: auditLogs.length }
      };
    } catch (error) {
      return this.createErrorResponse(500, 'AUDIT_ERROR', 'Failed to retrieve audit logs', requestId, error);
    }
  }

  /**
   * Handle get metrics endpoint
   */
  private async handleGetMetrics(requestId: string): Promise<ApiResponse> {
    const uptime = Date.now() - this.startTime.getTime();
    const averageResponseTime = this.requestCount > 0 ? this.totalResponseTime / this.requestCount : 0;
    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;

    const metrics: PerformanceMetrics = {
      requestCount: this.requestCount,
      averageResponseTime,
      errorRate,
      uptime,
      timestamp: new Date()
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: metrics
    };
  }

  /**
   * Check rate limiting for a client
   */
  private checkRateLimit(clientId: string): { allowed: boolean; resetTime?: number } {
    const now = Date.now();
    const clientData = this.rateLimitStore.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      // Reset or initialize rate limit window
      this.rateLimitStore.set(clientId, {
        count: 1,
        resetTime: now + this.rateLimitConfig.windowMs
      });
      return { allowed: true };
    }

    if (clientData.count >= this.rateLimitConfig.maxRequests) {
      return { allowed: false, resetTime: clientData.resetTime };
    }

    // Increment count
    clientData.count++;
    return { allowed: true };
  }

  /**
   * Authenticate request
   */
  private authenticate(request: ApiRequest): { success: boolean; message?: string } {
    // For now, implement basic authentication
    // In a real implementation, this would validate JWT tokens or API keys
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      return { success: false, message: 'Authorization header required' };
    }

    // Basic validation - in real implementation would validate against user store
    if (!authHeader.startsWith('Bearer ')) {
      return { success: false, message: 'Invalid authorization format' };
    }

    // For testing purposes, accept any bearer token
    // Real implementation would validate the token
    return { success: true };
  }

  /**
   * Get client identifier for rate limiting
   */
  private getClientId(request: ApiRequest): string {
    return request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown';
  }

  /**
   * Track performance metrics
   */
  private trackMetrics(responseTime: number, isError: boolean): void {
    this.requestCount++;
    this.totalResponseTime += responseTime;
    if (isError) {
      this.errorCount++;
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create standardized error response
   */
  private createErrorResponse(
    statusCode: number,
    code: string,
    message: string,
    requestId: string,
    error?: any
  ): ApiResponse {
    const apiError: ApiError = {
      code,
      message,
      requestId
    };

    if (error && process.env.NODE_ENV === 'development') {
      apiError.details = error.message;
    }

    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: { error: apiError }
    };
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const uptime = Date.now() - this.startTime.getTime();
    const averageResponseTime = this.requestCount > 0 ? this.totalResponseTime / this.requestCount : 0;
    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;

    return {
      requestCount: this.requestCount,
      averageResponseTime,
      errorRate,
      uptime,
      timestamp: new Date()
    };
  }

  /**
   * Configure rate limiting
   */
  configureRateLimit(config: RateLimitConfig): void {
    this.rateLimitConfig = config;
  }

  /**
   * Get registered connectors
   */
  getConnectors(): Map<string, any> {
    return new Map(this.connectors);
  }
}