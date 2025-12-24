/**
 * Exchange Connector interface and base implementation
 * Provides standardized interface for all exchange integrations
 */

import { Order, OrderSide, OrderStatus } from '../models/Order';
import { ConnectorStatus } from '../models/ConnectorStatus';
import { ErrorHandler, ApplicationError, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';
import { GracefulDegradationManager, ServiceCapability } from '../utils/GracefulDegradationManager';

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  passphrase?: string;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: Date;
}

export interface Balance {
  symbol: string;
  available: number;
  total: number;
}

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  orderType: 'limit';
}

export interface PlaceOrderResult {
  orderId: string;
  status: OrderStatus;
  timestamp: Date;
}

/**
 * Standardized interface for all exchange connectors
 */
export interface IExchangeConnector {
  /**
   * Establishes authenticated connection with the exchange
   */
  authenticate(credentials: ExchangeCredentials): Promise<boolean>;

  /**
   * Retrieves current balance for a specific symbol
   */
  getBalance(symbol: string): Promise<Balance>;

  /**
   * Places a limit order on the exchange
   */
  placeLimitOrder(params: PlaceOrderParams): Promise<PlaceOrderResult>;

  /**
   * Retrieves market depth data for a symbol
   */
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;

  /**
   * Verifies connector operational status
   */
  healthCheck(): Promise<boolean>;

  /**
   * Gets current connector status
   */
  getStatus(): ConnectorStatus;

  /**
   * Cancels an existing order
   */
  cancelOrder(orderId: string): Promise<boolean>;

  /**
   * Gets order status
   */
  getOrderStatus(orderId: string): Promise<Order | null>;
}

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  requestsPerSecond: number;
  burstSize: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Base exchange connector implementation with common functionality
 */
export abstract class BaseExchangeConnector implements IExchangeConnector {
  protected connectorId: string;
  protected name: string;
  protected credentials?: ExchangeCredentials;
  protected isAuthenticated: boolean = false;
  
  // Circuit breaker state
  private circuitBreakerState: CircuitBreakerState = 'closed';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private circuitBreakerConfig: CircuitBreakerConfig;
  
  // Rate limiting
  private requestTimes: number[] = [];
  private rateLimiterConfig: RateLimiterConfig;
  
  // Retry configuration
  private retryConfig: RetryConfig;
  
  // Status tracking
  private lastHealthCheck: Date = new Date();
  private latency: number = 0;
  private errorRate: number = 0;
  private recentErrors: number[] = [];

  constructor(
    connectorId: string,
    name: string,
    circuitBreakerConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 300000 // 5 minutes
    },
    rateLimiterConfig: RateLimiterConfig = {
      requestsPerSecond: 10,
      burstSize: 20
    },
    retryConfig: RetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2
    }
  ) {
    this.connectorId = connectorId;
    this.name = name;
    this.circuitBreakerConfig = circuitBreakerConfig;
    this.rateLimiterConfig = rateLimiterConfig;
    this.retryConfig = retryConfig;
  }

  /**
   * Executes a request with circuit breaker, rate limiting, and retry logic
   */
  protected async executeWithProtection<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Check circuit breaker
    if (!this.isCircuitBreakerClosed()) {
      throw new Error(`Circuit breaker is ${this.circuitBreakerState} for ${this.name}`);
    }

    // Apply rate limiting
    await this.applyRateLimit();

    // Execute with retry logic
    return this.executeWithRetry(operation, operationName);
  }

  /**
   * Circuit breaker implementation
   */
  private isCircuitBreakerClosed(): boolean {
    const now = Date.now();
    
    switch (this.circuitBreakerState) {
      case 'closed':
        return true;
        
      case 'open':
        if (now - this.lastFailureTime > this.circuitBreakerConfig.recoveryTimeout) {
          this.circuitBreakerState = 'half-open';
          return true;
        }
        return false;
        
      case 'half-open':
        return true;
        
      default:
        return false;
    }
  }

  /**
   * Records operation success for circuit breaker
   */
  private recordSuccess(): void {
    this.failureCount = 0;
    if (this.circuitBreakerState === 'half-open') {
      this.circuitBreakerState = 'closed';
    }
  }

  /**
   * Records operation failure for circuit breaker
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.circuitBreakerConfig.failureThreshold) {
      this.circuitBreakerState = 'open';
    }
    
    // Track error rate
    this.recentErrors.push(Date.now());
    this.cleanupOldErrors();
    this.updateErrorRate();
  }

  /**
   * Rate limiting implementation
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Clean up old request times
    this.requestTimes = this.requestTimes.filter(
      time => now - time < 1000 // Keep only requests from last second
    );
    
    // Check if we're over the rate limit
    if (this.requestTimes.length >= this.rateLimiterConfig.requestsPerSecond) {
      const oldestRequest = Math.min(...this.requestTimes);
      const waitTime = 1000 - (now - oldestRequest);
      
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    }
    
    this.requestTimes.push(now);
  }

  /**
   * Retry logic with exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        
        // Record success metrics
        this.latency = Date.now() - startTime;
        this.recordSuccess();
        
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure();
        
        // Don't retry on the last attempt
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
          this.retryConfig.maxDelay
        );
        
        await this.sleep(delay);
      }
    }
    
    throw new Error(`${operationName} failed after ${this.retryConfig.maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up old error records
   */
  private cleanupOldErrors(): void {
    const cutoff = Date.now() - this.circuitBreakerConfig.monitoringPeriod;
    this.recentErrors = this.recentErrors.filter(time => time > cutoff);
  }

  /**
   * Update error rate calculation
   */
  private updateErrorRate(): void {
    const totalRequests = this.requestTimes.length + this.recentErrors.length;
    this.errorRate = totalRequests > 0 ? this.recentErrors.length / totalRequests : 0;
  }

  // Abstract methods that must be implemented by concrete connectors
  abstract authenticate(credentials: ExchangeCredentials): Promise<boolean>;
  abstract getBalance(symbol: string): Promise<Balance>;
  abstract placeLimitOrder(params: PlaceOrderParams): Promise<PlaceOrderResult>;
  abstract getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  abstract cancelOrder(orderId: string): Promise<boolean>;
  abstract getOrderStatus(orderId: string): Promise<Order | null>;

  /**
   * Default health check implementation
   */
  async healthCheck(): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Perform a simple connectivity test
      const isHealthy = await this.performHealthCheck();
      
      this.lastHealthCheck = new Date();
      this.latency = Date.now() - startTime;
      
      return isHealthy;
    } catch (error) {
      this.recordFailure();
      return false;
    }
  }

  /**
   * Abstract method for connector-specific health checks
   */
  protected abstract performHealthCheck(): Promise<boolean>;

  /**
   * Get current connector status
   */
  getStatus(): ConnectorStatus {
    let status: 'healthy' | 'degraded' | 'offline';
    
    if (this.circuitBreakerState === 'open') {
      status = 'offline';
    } else if (this.circuitBreakerState === 'half-open' || this.errorRate > 0.1) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      connectorId: this.connectorId,
      connectorType: 'exchange',
      name: this.name,
      status,
      lastHealthCheck: this.lastHealthCheck,
      latency: this.latency,
      errorRate: this.errorRate,
      capabilities: this.getCapabilities()
    };
  }

  /**
   * Get connector capabilities
   */
  protected abstract getCapabilities(): string[];

  /**
   * Validate credentials have appropriate permissions
   */
  protected validateCredentials(credentials: ExchangeCredentials): void {
    if (!credentials.apiKey || !credentials.secret) {
      const error = new Error('Invalid credentials: API key and secret are required');
      error.name = 'AUTHENTICATION_ERROR';
      throw error;
    }
    
    if (credentials.apiKey.length < 10) {
      const error = new Error('Invalid credentials: API key appears to be too short');
      error.name = 'AUTHENTICATION_ERROR';
      throw error;
    }
    
    if (credentials.secret.length < 10) {
      const error = new Error('Invalid credentials: Secret appears to be too short');
      error.name = 'AUTHENTICATION_ERROR';
      throw error;
    }
  }
}