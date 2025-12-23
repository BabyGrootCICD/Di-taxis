/**
 * On-Chain Tracker interface and base implementation
 * Provides standardized interface for blockchain monitoring
 */

import { ConnectorStatus } from '../models/ConnectorStatus';

export interface TokenBalance {
  address: string;
  tokenContract: string;
  symbol: string;
  balance: number;
  decimals: number;
  lastUpdated: Date;
}

export interface TransferDetails {
  transactionHash: string;
  blockNumber: number;
  from: string;
  to: string;
  amount: number;
  tokenContract: string;
  symbol: string;
  timestamp: Date;
  confirmations: number;
}

export interface ConfirmationStatus {
  transactionHash: string;
  confirmations: number;
  requiredConfirmations: number;
  isConfirmed: boolean;
  blockNumber: number;
  timestamp: Date;
}

export type TrackerStatus = 'connected' | 'disconnected' | 'syncing' | 'error';

/**
 * Standardized interface for all on-chain trackers
 */
export interface IOnChainTracker {
  /**
   * Queries current token balance for a specific address and token contract
   */
  getBalance(address: string, tokenContract: string): Promise<TokenBalance>;

  /**
   * Monitors for new transfers involving the specified address and token
   */
  trackTransfers(address: string, tokenContract: string): Promise<TransferDetails[]>;

  /**
   * Gets confirmation status for a specific transaction
   */
  getConfirmationStatus(txHash: string): Promise<ConfirmationStatus>;

  /**
   * Sets the required confirmation threshold
   */
  setConfirmationThreshold(confirmations: number): void;

  /**
   * Gets current confirmation threshold
   */
  getConfirmationThreshold(): number;

  /**
   * Verifies blockchain connectivity
   */
  healthCheck(): Promise<boolean>;

  /**
   * Gets current tracker status
   */
  getStatus(): ConnectorStatus;

  /**
   * Starts monitoring for the specified address and token
   */
  startMonitoring(address: string, tokenContract: string): Promise<void>;

  /**
   * Stops monitoring for the specified address and token
   */
  stopMonitoring(address: string, tokenContract: string): Promise<void>;
}

/**
 * Retry configuration for blockchain operations
 */
export interface BlockchainRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Base on-chain tracker implementation with common functionality
 */
export abstract class BaseOnChainTracker implements IOnChainTracker {
  protected trackerId: string;
  protected name: string;
  protected confirmationThreshold: number = 12; // Default for Ethereum
  protected status: TrackerStatus = 'disconnected';
  
  // Retry configuration
  private retryConfig: BlockchainRetryConfig;
  
  // Status tracking
  private lastHealthCheck: Date = new Date();
  private latency: number = 0;
  private errorRate: number = 0;
  private recentErrors: number[] = [];
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 5;
  
  // Monitoring state
  private monitoredAddresses: Map<string, Set<string>> = new Map(); // address -> set of token contracts

  constructor(
    trackerId: string,
    name: string,
    retryConfig: BlockchainRetryConfig = {
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      backoffMultiplier: 2
    }
  ) {
    this.trackerId = trackerId;
    this.name = name;
    this.retryConfig = retryConfig;
  }

  /**
   * Executes blockchain operation with retry logic
   */
  protected async executeWithRetry<T>(
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
   * Records operation success
   */
  private recordSuccess(): void {
    this.connectionAttempts = 0;
    if (this.status === 'error') {
      this.status = 'connected';
    }
  }

  /**
   * Records operation failure
   */
  private recordFailure(): void {
    this.connectionAttempts++;
    
    // Track error rate
    this.recentErrors.push(Date.now());
    this.cleanupOldErrors();
    this.updateErrorRate();
    
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      this.status = 'error';
    }
  }

  /**
   * Clean up old error records
   */
  private cleanupOldErrors(): void {
    const cutoff = Date.now() - 300000; // 5 minutes
    this.recentErrors = this.recentErrors.filter(time => time > cutoff);
  }

  /**
   * Update error rate calculation
   */
  private updateErrorRate(): void {
    const totalOperations = 100; // Approximate recent operations
    this.errorRate = this.recentErrors.length / totalOperations;
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sets confirmation threshold
   */
  setConfirmationThreshold(confirmations: number): void {
    if (confirmations < 1) {
      throw new Error('Confirmation threshold must be at least 1');
    }
    this.confirmationThreshold = confirmations;
  }

  /**
   * Gets confirmation threshold
   */
  getConfirmationThreshold(): number {
    return this.confirmationThreshold;
  }

  /**
   * Default health check implementation
   */
  async healthCheck(): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Perform blockchain-specific health check
      const isHealthy = await this.performHealthCheck();
      
      this.lastHealthCheck = new Date();
      this.latency = Date.now() - startTime;
      
      if (isHealthy) {
        this.status = 'connected';
      } else {
        this.status = 'error';
      }
      
      return isHealthy;
    } catch (error) {
      this.recordFailure();
      this.status = 'error';
      return false;
    }
  }

  /**
   * Get current tracker status
   */
  getStatus(): ConnectorStatus {
    let healthStatus: 'healthy' | 'degraded' | 'offline';
    
    switch (this.status) {
      case 'connected':
        healthStatus = this.errorRate > 0.1 ? 'degraded' : 'healthy';
        break;
      case 'syncing':
        healthStatus = 'degraded';
        break;
      case 'disconnected':
      case 'error':
        healthStatus = 'offline';
        break;
      default:
        healthStatus = 'offline';
    }

    return {
      connectorId: this.trackerId,
      connectorType: 'onchain',
      name: this.name,
      status: healthStatus,
      lastHealthCheck: this.lastHealthCheck,
      latency: this.latency,
      errorRate: this.errorRate,
      capabilities: this.getCapabilities()
    };
  }

  /**
   * Start monitoring an address and token contract
   */
  async startMonitoring(address: string, tokenContract: string): Promise<void> {
    if (!this.monitoredAddresses.has(address)) {
      this.monitoredAddresses.set(address, new Set());
    }
    
    this.monitoredAddresses.get(address)!.add(tokenContract);
    
    // Perform initial balance check to verify connectivity
    await this.getBalance(address, tokenContract);
  }

  /**
   * Stop monitoring an address and token contract
   */
  async stopMonitoring(address: string, tokenContract: string): Promise<void> {
    const tokens = this.monitoredAddresses.get(address);
    if (tokens) {
      tokens.delete(tokenContract);
      if (tokens.size === 0) {
        this.monitoredAddresses.delete(address);
      }
    }
  }

  /**
   * Get monitored addresses
   */
  protected getMonitoredAddresses(): Map<string, Set<string>> {
    return this.monitoredAddresses;
  }

  // Abstract methods that must be implemented by concrete trackers
  abstract getBalance(address: string, tokenContract: string): Promise<TokenBalance>;
  abstract trackTransfers(address: string, tokenContract: string): Promise<TransferDetails[]>;
  abstract getConfirmationStatus(txHash: string): Promise<ConfirmationStatus>;
  
  /**
   * Abstract method for tracker-specific health checks
   */
  protected abstract performHealthCheck(): Promise<boolean>;

  /**
   * Get tracker capabilities
   */
  protected abstract getCapabilities(): string[];
}