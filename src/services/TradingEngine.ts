/**
 * Trading Engine with risk controls and intelligent venue routing
 * Handles order management, execution, and state tracking
 */

import { Order, OrderSide, OrderStatus, Fill } from '../models/Order';
import { IExchangeConnector, PlaceOrderParams, PlaceOrderResult } from '../connectors/ExchangeConnector';
import { AuditService } from './AuditService';
import { ErrorHandler, ApplicationError, ErrorCategory, ErrorSeverity, withErrorHandling } from '../utils/ErrorHandler';
import { StateRecoveryManager } from '../utils/StateRecoveryManager';
import { GracefulDegradationManager, ServiceCapability } from '../utils/GracefulDegradationManager';
import { ConnectorStatus } from '../models/ConnectorStatus';

export interface SlippageGuardConfig {
  maxSlippagePercent: number;
  enableSlippageProtection: boolean;
}

export interface VenueScore {
  venueId: string;
  score: number;
  reasons: string[];
}

export interface TradingEngineConfig {
  slippageGuard: SlippageGuardConfig;
  maxOrderRetries: number;
  orderTimeoutMs: number;
}

/**
 * Trading Engine class for order management and execution
 */
export class TradingEngine {
  private connectors: Map<string, IExchangeConnector> = new Map();
  private orders: Map<string, Order> = new Map();
  private auditService: AuditService;
  private config: TradingEngineConfig;
  private errorHandler: ErrorHandler;
  private stateRecoveryManager: StateRecoveryManager;
  private degradationManager: GracefulDegradationManager;

  constructor(
    auditService: AuditService,
    config: TradingEngineConfig = {
      slippageGuard: {
        maxSlippagePercent: 2.0,
        enableSlippageProtection: true
      },
      maxOrderRetries: 3,
      orderTimeoutMs: 30000
    },
    errorHandler?: ErrorHandler,
    stateRecoveryManager?: StateRecoveryManager,
    degradationManager?: GracefulDegradationManager
  ) {
    this.auditService = auditService;
    this.config = config;
    this.errorHandler = errorHandler || new ErrorHandler();
    this.stateRecoveryManager = stateRecoveryManager || new StateRecoveryManager(auditService);
    this.degradationManager = degradationManager || new GracefulDegradationManager(auditService);
    
    this.initializeErrorHandling();
  }

  /**
   * Registers an exchange connector
   */
  registerConnector(venueId: string, connector: IExchangeConnector): void {
    this.connectors.set(venueId, connector);
  }

  /**
   * Places a limit order with slippage protection and optimal venue routing
   */
  async placeLimitOrder(
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number,
    slippageLimit: number,
    userId?: string
  ): Promise<Order> {
    return this.degradationManager.executeWithDegradation(
      ServiceCapability.TRADING,
      async () => {
        return this.errorHandler.handleError(
          async () => {
            // Generate order ID
            const orderId = this.generateOrderId();
            
            // Create order object
            const order: Order = {
              orderId,
              venueId: '', // Will be set after venue selection
              symbol,
              side,
              orderType: 'limit',
              quantity,
              price,
              slippageLimit,
              status: 'pending',
              createdAt: new Date(),
              fills: []
            };

            try {
              // Apply slippage guard
              if (this.config.slippageGuard.enableSlippageProtection) {
                await this.applySlippageGuard(symbol, side, price, slippageLimit);
              }

              // Select optimal venue
              const selectedVenue = await this.selectOptimalVenue(symbol, side, quantity, price);
              order.venueId = selectedVenue;

              // Store order
              this.orders.set(orderId, order);

              // Execute order
              const connector = this.connectors.get(selectedVenue);
              if (!connector) {
                throw new ApplicationError(
                  `Connector not found for venue: ${selectedVenue}`,
                  'CONNECTOR_NOT_FOUND',
                  ErrorCategory.SYSTEM,
                  ErrorSeverity.HIGH,
                  {
                    operation: 'placeLimitOrder',
                    component: 'TradingEngine',
                    venueId: selectedVenue,
                    timestamp: new Date()
                  }
                );
              }

              const orderParams: PlaceOrderParams = {
                symbol,
                side,
                quantity,
                price,
                orderType: 'limit'
              };

              const result = await connector.placeLimitOrder(orderParams);
              
              // Update order with execution result
              order.status = result.status;
              order.executedAt = result.timestamp;

              // Log trade execution
              this.auditService.logTradeExecution(
                {
                  orderId: order.orderId,
                  symbol: order.symbol,
                  side: order.side,
                  quantity: order.quantity,
                  price: order.price,
                  slippageLimit: order.slippageLimit
                },
                {
                  venueOrderId: result.orderId,
                  status: result.status,
                  executedAt: result.timestamp
                },
                userId,
                selectedVenue
              );

              return order;

            } catch (error) {
              // Update order status to rejected
              order.status = 'rejected';
              this.orders.set(orderId, order);

              // Log failed execution
              this.auditService.logSecurityEvent(
                'ORDER_EXECUTION_FAILED',
                {
                  orderId: order.orderId,
                  symbol: order.symbol,
                  side: order.side,
                  quantity: order.quantity,
                  price: order.price,
                  error: error instanceof Error ? error.message : 'Unknown error'
                },
                userId,
                order.venueId
              );

              throw error;
            }
          },
          {
            operation: 'placeLimitOrder',
            component: 'TradingEngine',
            userId,
            timestamp: new Date(),
            metadata: { symbol, side, quantity, price }
          }
        ).then(result => {
          if (!result.success) {
            throw result.error;
          }
          return result.result;
        });
      },
      {
        operation: 'placeLimitOrder',
        component: 'TradingEngine',
        userId
      }
    );
  }

  /**
   * Cancels an existing order
   */
  async cancelOrder(orderId: string, userId?: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status === 'filled' || order.status === 'cancelled') {
      throw new Error(`Cannot cancel order in status: ${order.status}`);
    }

    try {
      const connector = this.connectors.get(order.venueId);
      if (!connector) {
        throw new Error(`Connector not found for venue: ${order.venueId}`);
      }

      const success = await connector.cancelOrder(orderId);
      
      if (success) {
        order.status = 'cancelled';
        this.orders.set(orderId, order);

        // Log cancellation
        this.auditService.logSecurityEvent(
          'ORDER_CANCELLED',
          {
            orderId: order.orderId,
            symbol: order.symbol,
            side: order.side,
            quantity: order.quantity,
            price: order.price
          },
          userId,
          order.venueId
        );
      }

      return success;
    } catch (error) {
      // Log failed cancellation
      this.auditService.logSecurityEvent(
        'ORDER_CANCELLATION_FAILED',
        {
          orderId: order.orderId,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
        userId,
        order.venueId
      );

      throw error;
    }
  }

  /**
   * Gets order status
   */
  getOrderStatus(orderId: string): Order | null {
    return this.orders.get(orderId) || null;
  }

  /**
   * Gets execution history
   */
  getExecutionHistory(userId?: string): Order[] {
    return Array.from(this.orders.values()).filter(order => 
      order.status === 'filled' || order.status === 'partial'
    );
  }

  /**
   * Gets all orders
   */
  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  /**
   * Applies slippage guard to prevent excessive slippage
   */
  private async applySlippageGuard(
    symbol: string,
    side: OrderSide,
    price: number,
    slippageLimit: number
  ): Promise<void> {
    // Get current market prices from available venues
    const marketPrices = await this.getCurrentMarketPrices(symbol);
    
    if (marketPrices.length === 0) {
      throw new Error('No market data available for slippage calculation');
    }

    // Calculate best available price
    const bestPrice = side === 'buy' 
      ? Math.min(...marketPrices.map(p => p.ask))
      : Math.max(...marketPrices.map(p => p.bid));

    // Calculate slippage percentage
    const slippagePercent = side === 'buy'
      ? ((price - bestPrice) / bestPrice) * 100
      : ((bestPrice - price) / bestPrice) * 100;

    // Check against configured maximum and order-specific limit
    const maxAllowedSlippage = Math.min(
      this.config.slippageGuard.maxSlippagePercent,
      slippageLimit
    );

    if (slippagePercent > maxAllowedSlippage) {
      throw new Error(
        `Slippage protection triggered: ${slippagePercent.toFixed(2)}% exceeds limit of ${maxAllowedSlippage.toFixed(2)}%`
      );
    }
  }

  /**
   * Selects optimal venue for order execution
   */
  private async selectOptimalVenue(
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number
  ): Promise<string> {
    const availableVenues = await this.getHealthyVenues();
    
    if (availableVenues.length === 0) {
      throw new Error('No healthy venues available for trading');
    }

    // Score each venue based on multiple factors
    const venueScores: VenueScore[] = [];

    for (const venueId of availableVenues) {
      const score = await this.calculateVenueScore(venueId, symbol, side, quantity, price);
      venueScores.push(score);
    }

    // Sort by score (highest first)
    venueScores.sort((a, b) => b.score - a.score);

    // Return the best venue
    return venueScores[0].venueId;
  }

  /**
   * Calculates venue score for optimal routing
   */
  private async calculateVenueScore(
    venueId: string,
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number
  ): Promise<VenueScore> {
    const connector = this.connectors.get(venueId);
    if (!connector) {
      return { venueId, score: 0, reasons: ['Connector not available'] };
    }

    let score = 0;
    const reasons: string[] = [];

    try {
      // Factor 1: Connector health and performance
      const status = connector.getStatus();
      if (status.status === 'healthy') {
        score += 40;
        reasons.push('Healthy status');
      } else if (status.status === 'degraded') {
        score += 20;
        reasons.push('Degraded status');
      } else {
        score += 0;
        reasons.push('Offline status');
      }

      // Factor 2: Latency (lower is better)
      const latencyScore = Math.max(0, 20 - (status.latency / 100));
      score += latencyScore;
      reasons.push(`Latency: ${status.latency}ms`);

      // Factor 3: Error rate (lower is better)
      const errorScore = Math.max(0, 20 - (status.errorRate * 100));
      score += errorScore;
      reasons.push(`Error rate: ${(status.errorRate * 100).toFixed(1)}%`);

      // Factor 4: Market depth and liquidity
      const orderBook = await connector.getOrderBook(symbol, 10);
      const relevantSide = side === 'buy' ? orderBook.asks : orderBook.bids;
      
      let liquidityScore = 0;
      let availableQuantity = 0;
      
      for (const entry of relevantSide) {
        if (side === 'buy' && entry.price <= price * 1.01) { // Within 1% of target price
          availableQuantity += entry.quantity;
        } else if (side === 'sell' && entry.price >= price * 0.99) { // Within 1% of target price
          availableQuantity += entry.quantity;
        }
      }

      if (availableQuantity >= quantity) {
        liquidityScore = 20;
        reasons.push('Sufficient liquidity');
      } else {
        liquidityScore = (availableQuantity / quantity) * 20;
        reasons.push(`Partial liquidity: ${availableQuantity}/${quantity}`);
      }

      score += liquidityScore;

    } catch (error) {
      reasons.push(`Error calculating score: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return { venueId, score, reasons };
  }

  /**
   * Gets healthy venues for trading
   */
  private async getHealthyVenues(): Promise<string[]> {
    const healthyVenues: string[] = [];

    for (const [venueId, connector] of this.connectors) {
      try {
        const status = connector.getStatus();
        if (status.status === 'healthy' || status.status === 'degraded') {
          healthyVenues.push(venueId);
        }
      } catch (error) {
        // Skip venues that can't provide status
        continue;
      }
    }

    return healthyVenues;
  }

  /**
   * Gets current market prices from all available venues
   */
  private async getCurrentMarketPrices(symbol: string): Promise<Array<{bid: number, ask: number, venueId: string}>> {
    const prices: Array<{bid: number, ask: number, venueId: string}> = [];

    for (const [venueId, connector] of this.connectors) {
      try {
        const orderBook = await connector.getOrderBook(symbol, 1);
        if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
          prices.push({
            bid: orderBook.bids[0].price,
            ask: orderBook.asks[0].price,
            venueId
          });
        }
      } catch (error) {
        // Skip venues that can't provide market data
        continue;
      }
    }

    return prices;
  }

  /**
   * Generates unique order ID
   */
  private generateOrderId(): string {
    return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Updates slippage guard configuration
   */
  updateSlippageGuardConfig(config: SlippageGuardConfig): void {
    this.config.slippageGuard = config;
  }

  /**
   * Gets current configuration
   */
  getConfig(): TradingEngineConfig {
    return { ...this.config };
  }

  /**
   * Initializes error handling strategies
   */
  private initializeErrorHandling(): void {
    // Register recovery strategies for trading operations
    this.errorHandler.registerRecoveryStrategy('placeLimitOrder', {
      strategy: 'retry' as any,
      maxAttempts: this.config.maxOrderRetries,
      backoffMs: 2000,
      fallbackFunction: async () => {
        // Try alternative venue if available
        const healthyVenues = await this.getHealthyVenues();
        if (healthyVenues.length > 1) {
          throw new ApplicationError(
            'Primary venue failed, retry with venue selection',
            'VENUE_FAILOVER',
            ErrorCategory.EXTERNAL_SERVICE,
            ErrorSeverity.MEDIUM,
            {
              operation: 'placeLimitOrder',
              component: 'TradingEngine',
              timestamp: new Date()
            },
            { isRetryable: true }
          );
        }
        throw new ApplicationError(
          'No alternative venues available',
          'NO_VENUES_AVAILABLE',
          ErrorCategory.EXTERNAL_SERVICE,
          ErrorSeverity.HIGH,
          {
            operation: 'placeLimitOrder',
            component: 'TradingEngine',
            timestamp: new Date()
          }
        );
      }
    });

    this.errorHandler.registerRecoveryStrategy('getHealthyVenues', {
      strategy: 'retry' as any,
      maxAttempts: 2,
      backoffMs: 1000,
      degradedFunction: async () => {
        // Return all registered venues as fallback
        return Array.from(this.connectors.keys());
      }
    });
  }

  /**
   * Gets current state for recovery purposes
   */
  async getState(): Promise<Record<string, any>> {
    return {
      orders: Object.fromEntries(this.orders),
      connectors: Array.from(this.connectors.keys()),
      config: this.config,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Restores state from recovery data
   */
  async setState(state: Record<string, any>): Promise<void> {
    if (state.orders) {
      this.orders = new Map(Object.entries(state.orders));
    }
    if (state.config) {
      this.config = { ...this.config, ...state.config };
    }
  }

  /**
   * Creates a recovery point
   */
  async createRecoveryPoint(description: string): Promise<string> {
    const components = new Map([['TradingEngine', this]]);
    const snapshotId = await this.stateRecoveryManager.createStateSnapshot(components, {
      description,
      orderCount: this.orders.size,
      connectorCount: this.connectors.size
    });
    
    return this.stateRecoveryManager.createRecoveryPoint(snapshotId, description);
  }

  /**
   * Recovers from a specific recovery point
   */
  async recoverFromPoint(recoveryPointId: string): Promise<void> {
    const components = new Map([['TradingEngine', this]]);
    const result = await this.stateRecoveryManager.recoverFromPoint(recoveryPointId, components);
    
    if (!result.success) {
      throw new ApplicationError(
        `Recovery failed: ${result.errors.map(e => e.message).join(', ')}`,
        'RECOVERY_FAILED',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: 'recoverFromPoint',
          component: 'TradingEngine',
          timestamp: new Date()
        }
      );
    }

    // Log successful recovery
    this.auditService.logSecurityEvent('TRADING_ENGINE_RECOVERED', {
      recoveryPointId,
      recoveredComponents: result.recoveredComponents,
      timestamp: new Date().toISOString()
    });
  }
}