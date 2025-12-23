/**
 * Property-based tests for TradingEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TradingEngine, SlippageGuardConfig } from './TradingEngine';
import { AuditService } from './AuditService';
import { IExchangeConnector, PlaceOrderParams, PlaceOrderResult, OrderBook, Balance } from '../connectors/ExchangeConnector';
import { Order, OrderSide, OrderStatus } from '../models/Order';
import { ConnectorStatus } from '../models/ConnectorStatus';

// Mock connector implementation for testing
class MockExchangeConnector implements IExchangeConnector {
  private mockOrderBook: OrderBook;
  private mockBalance: Balance;
  private mockStatus: ConnectorStatus;
  private shouldFailHealthCheck: boolean = false;
  private shouldFailOrderPlacement: boolean = false;
  private placedOrders: Map<string, Order> = new Map();

  constructor(
    venueId: string,
    mockOrderBook?: OrderBook,
    mockBalance?: Balance,
    mockStatus?: Partial<ConnectorStatus>
  ) {
    this.mockOrderBook = mockOrderBook || {
      bids: [{ price: 100, quantity: 10 }],
      asks: [{ price: 101, quantity: 10 }],
      timestamp: new Date()
    };
    
    this.mockBalance = mockBalance || {
      symbol: 'XAU',
      available: 1000,
      total: 1000
    };

    this.mockStatus = {
      connectorId: venueId,
      connectorType: 'exchange',
      name: `Mock ${venueId}`,
      status: 'healthy',
      lastHealthCheck: new Date(),
      latency: 50,
      errorRate: 0,
      capabilities: ['trading', 'market_data'],
      ...mockStatus
    };
  }

  async authenticate(): Promise<boolean> {
    return true;
  }

  async getBalance(): Promise<Balance> {
    return this.mockBalance;
  }

  async placeLimitOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    if (this.shouldFailOrderPlacement) {
      throw new Error('Order placement failed');
    }

    const orderId = `mock_order_${Date.now()}`;
    const result: PlaceOrderResult = {
      orderId,
      status: 'filled',
      timestamp: new Date()
    };

    // Store the order for tracking
    const order: Order = {
      orderId,
      venueId: this.mockStatus.connectorId,
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      quantity: params.quantity,
      price: params.price,
      slippageLimit: 0,
      status: 'filled',
      createdAt: new Date(),
      fills: []
    };
    this.placedOrders.set(orderId, order);

    return result;
  }

  async getOrderBook(): Promise<OrderBook> {
    return this.mockOrderBook;
  }

  async healthCheck(): Promise<boolean> {
    return !this.shouldFailHealthCheck;
  }

  getStatus(): ConnectorStatus {
    return this.mockStatus;
  }

  async cancelOrder(): Promise<boolean> {
    return true;
  }

  async getOrderStatus(orderId: string): Promise<Order | null> {
    return this.placedOrders.get(orderId) || null;
  }

  // Test utilities
  setOrderBook(orderBook: OrderBook): void {
    this.mockOrderBook = orderBook;
  }

  setStatus(status: Partial<ConnectorStatus>): void {
    this.mockStatus = { ...this.mockStatus, ...status };
  }

  setShouldFailHealthCheck(shouldFail: boolean): void {
    this.shouldFailHealthCheck = shouldFail;
  }

  setShouldFailOrderPlacement(shouldFail: boolean): void {
    this.shouldFailOrderPlacement = shouldFail;
  }
}

describe('TradingEngine Property Tests', () => {
  let tradingEngine: TradingEngine;
  let auditService: AuditService;
  let mockConnector1: MockExchangeConnector;
  let mockConnector2: MockExchangeConnector;

  beforeEach(() => {
    auditService = new AuditService();
    tradingEngine = new TradingEngine(auditService);
    
    // Create mock connectors
    mockConnector1 = new MockExchangeConnector('venue1');
    mockConnector2 = new MockExchangeConnector('venue2');
    
    // Register connectors
    tradingEngine.registerConnector('venue1', mockConnector1);
    tradingEngine.registerConnector('venue2', mockConnector2);
  });

  /**
   * **Feature: gold-router-app, Property 12: Slippage guard prevents excessive slippage**
   * **Validates: Requirements 3.2**
   */
  it('should prevent order execution when slippage exceeds configured thresholds', () => {
    return fc.assert(fc.asyncProperty(
      fc.record({
        symbol: fc.constantFrom('XAU', 'KAU', 'XAUT'),
        side: fc.constantFrom('buy', 'sell') as fc.Arbitrary<OrderSide>,
        quantity: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
        marketPrice: fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
        orderPrice: fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
        slippageLimit: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
        maxSlippagePercent: fc.float({ min: Math.fround(0.1), max: Math.fround(5), noNaN: true })
      }),
      async ({ symbol, side, quantity, marketPrice, orderPrice, slippageLimit, maxSlippagePercent }) => {
        // Configure slippage guard
        const slippageConfig: SlippageGuardConfig = {
          maxSlippagePercent,
          enableSlippageProtection: true
        };
        tradingEngine.updateSlippageGuardConfig(slippageConfig);

        // Set up market data with known prices
        const orderBook: OrderBook = {
          bids: [{ price: marketPrice, quantity: 1000 }],
          asks: [{ price: marketPrice, quantity: 1000 }],
          timestamp: new Date()
        };
        
        mockConnector1.setOrderBook(orderBook);
        mockConnector2.setOrderBook(orderBook);

        // Calculate expected slippage
        const bestPrice = side === 'buy' ? marketPrice : marketPrice;
        const slippagePercent = side === 'buy'
          ? ((orderPrice - bestPrice) / bestPrice) * 100
          : ((bestPrice - orderPrice) / bestPrice) * 100;

        const maxAllowedSlippage = Math.min(maxSlippagePercent, slippageLimit);

        try {
          await tradingEngine.placeLimitOrder(symbol, side, quantity, orderPrice, slippageLimit);
          
          // If we reach here, the order was placed successfully
          // This should only happen when slippage is within limits
          expect(slippagePercent).toBeLessThanOrEqual(maxAllowedSlippage + 0.01); // Small tolerance for floating point
        } catch (error) {
          // If an error was thrown, it should be due to slippage protection
          if (error instanceof Error && error.message.includes('Slippage protection triggered')) {
            // This should only happen when slippage exceeds limits
            expect(slippagePercent).toBeGreaterThan(maxAllowedSlippage - 0.01); // Small tolerance for floating point
          } else {
            // Re-throw unexpected errors
            throw error;
          }
        }
      }
    ), { numRuns: 100 });
  });

  /**
   * **Feature: gold-router-app, Property 13: Order executions are audited**
   * **Validates: Requirements 3.3**
   */
  it('should audit all order executions with complete transaction details', () => {
    return fc.assert(fc.asyncProperty(
      fc.record({
        symbol: fc.constantFrom('XAU', 'KAU', 'XAUT'),
        side: fc.constantFrom('buy', 'sell') as fc.Arbitrary<OrderSide>,
        quantity: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
        price: fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
        slippageLimit: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
        userId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
      }),
      async ({ symbol, side, quantity, price, slippageLimit, userId }) => {
        // Clear audit log before test
        auditService.clearLog();

        // Disable slippage protection to focus on auditing
        tradingEngine.updateSlippageGuardConfig({
          maxSlippagePercent: 100,
          enableSlippageProtection: false
        });

        try {
          // Place an order
          const order = await tradingEngine.placeLimitOrder(symbol, side, quantity, price, slippageLimit, userId);

          // Verify audit log contains the execution event
          const auditEvents = auditService.getAllEvents();
          const tradeExecutionEvents = auditEvents.filter(event => event.eventType === 'TRADE_EXECUTION');

          // Should have exactly one trade execution event
          expect(tradeExecutionEvents).toHaveLength(1);

          const executionEvent = tradeExecutionEvents[0];

          // Verify event contains required details
          expect(executionEvent.eventType).toBe('TRADE_EXECUTION');
          expect(executionEvent.userId).toBe(userId);
          expect(executionEvent.venueId).toBe(order.venueId);
          expect(executionEvent.timestamp).toBeInstanceOf(Date);
          expect(executionEvent.signature).toBeDefined();
          expect(executionEvent.signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex signature

          // Verify order details are in the audit event
          expect(executionEvent.details.orderDetails).toBeDefined();
          expect(executionEvent.details.orderDetails.orderId).toBe(order.orderId);
          expect(executionEvent.details.orderDetails.symbol).toBe(symbol);
          expect(executionEvent.details.orderDetails.side).toBe(side);
          expect(executionEvent.details.orderDetails.quantity).toBe(quantity);
          expect(executionEvent.details.orderDetails.price).toBe(price);
          expect(executionEvent.details.orderDetails.slippageLimit).toBe(slippageLimit);

          // Verify execution result is in the audit event
          expect(executionEvent.details.executionResult).toBeDefined();
          expect(executionEvent.details.executionResult.status).toBeDefined();
          expect(executionEvent.details.executionResult.executedAt).toBeDefined();

        } catch (error) {
          // If order fails, should still have audit event for the failure
          const auditEvents = auditService.getAllEvents();
          const failureEvents = auditEvents.filter(event => event.eventType === 'ORDER_EXECUTION_FAILED');

          // Should have exactly one failure event
          expect(failureEvents).toHaveLength(1);

          const failureEvent = failureEvents[0];
          expect(failureEvent.eventType).toBe('ORDER_EXECUTION_FAILED');
          expect(failureEvent.userId).toBe(userId);
          expect(failureEvent.details.symbol).toBe(symbol);
          expect(failureEvent.details.side).toBe(side);
          expect(failureEvent.details.quantity).toBe(quantity);
          expect(failureEvent.details.price).toBe(price);
          expect(failureEvent.details.error).toBeDefined();
        }
      }
    ), { numRuns: 100 });
  });

  /**
   * **Feature: gold-router-app, Property 14: Order failures maintain system state**
   * **Validates: Requirements 3.4**
   */
  it('should maintain consistent system state when order execution fails', () => {
    return fc.assert(fc.asyncProperty(
      fc.record({
        symbol: fc.constantFrom('XAU', 'KAU', 'XAUT'),
        side: fc.constantFrom('buy', 'sell') as fc.Arbitrary<OrderSide>,
        quantity: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
        price: fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
        slippageLimit: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
        shouldFailOrder: fc.boolean(),
        userId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
      }),
      async ({ symbol, side, quantity, price, slippageLimit, shouldFailOrder, userId }) => {
        // Clear audit log and get initial state
        auditService.clearLog();
        const initialOrders = tradingEngine.getAllOrders();
        const initialOrderCount = initialOrders.length;

        // Configure connector to fail if needed
        mockConnector1.setShouldFailOrderPlacement(shouldFailOrder);
        mockConnector2.setShouldFailOrderPlacement(shouldFailOrder);

        // Disable slippage protection to focus on state consistency
        tradingEngine.updateSlippageGuardConfig({
          maxSlippagePercent: 100,
          enableSlippageProtection: false
        });

        let orderPlaced = false;
        let thrownError: Error | null = null;

        try {
          const order = await tradingEngine.placeLimitOrder(symbol, side, quantity, price, slippageLimit, userId);
          orderPlaced = true;

          // If order was placed successfully, verify it's in the system
          const currentOrders = tradingEngine.getAllOrders();
          expect(currentOrders).toHaveLength(initialOrderCount + 1);

          const placedOrder = tradingEngine.getOrderStatus(order.orderId);
          expect(placedOrder).not.toBeNull();
          expect(placedOrder!.orderId).toBe(order.orderId);
          expect(placedOrder!.symbol).toBe(symbol);
          expect(placedOrder!.side).toBe(side);
          expect(placedOrder!.quantity).toBe(quantity);
          expect(placedOrder!.price).toBe(price);
          expect(placedOrder!.slippageLimit).toBe(slippageLimit);

          // Order should have a valid status
          expect(['pending', 'partial', 'filled', 'cancelled', 'rejected']).toContain(placedOrder!.status);

        } catch (error) {
          thrownError = error as Error;

          // If order failed, verify system state is consistent
          const currentOrders = tradingEngine.getAllOrders();

          if (shouldFailOrder) {
            // When we expect failure, the order should still be recorded but with rejected status
            expect(currentOrders).toHaveLength(initialOrderCount + 1);
            
            // Find the rejected order
            const rejectedOrder = currentOrders.find(o => 
              o.symbol === symbol && 
              o.side === side && 
              o.quantity === quantity && 
              o.price === price
            );
            
            expect(rejectedOrder).toBeDefined();
            expect(rejectedOrder!.status).toBe('rejected');
          } else {
            // If we didn't expect failure but got one, it might be due to other reasons
            // The system should still maintain consistency
            expect(currentOrders.length).toBeGreaterThanOrEqual(initialOrderCount);
          }
        }

        // Verify audit log consistency
        const auditEvents = auditService.getAllEvents();
        
        if (orderPlaced) {
          // Should have trade execution event
          const executionEvents = auditEvents.filter(event => event.eventType === 'TRADE_EXECUTION');
          expect(executionEvents).toHaveLength(1);
        } else if (thrownError) {
          // Should have failure event
          const failureEvents = auditEvents.filter(event => event.eventType === 'ORDER_EXECUTION_FAILED');
          expect(failureEvents).toHaveLength(1);
        }

        // Verify all audit events have proper structure
        auditEvents.forEach(event => {
          expect(event.eventId).toBeDefined();
          expect(event.timestamp).toBeInstanceOf(Date);
          expect(event.eventType).toBeDefined();
          expect(event.signature).toBeDefined();
          expect(event.signature).toMatch(/^[a-f0-9]{64}$/);
        });

        // Reset connector state for next test
        mockConnector1.setShouldFailOrderPlacement(false);
        mockConnector2.setShouldFailOrderPlacement(false);
      }
    ), { numRuns: 100 });
  });

  /**
   * **Feature: gold-router-app, Property 15: Multi-venue routing optimizes execution**
   * **Validates: Requirements 3.5**
   */
  it('should route orders to venues with optimal execution conditions', () => {
    return fc.assert(fc.asyncProperty(
      fc.record({
        symbol: fc.constantFrom('XAU', 'KAU', 'XAUT'),
        side: fc.constantFrom('buy', 'sell') as fc.Arbitrary<OrderSide>,
        quantity: fc.float({ min: Math.fround(0.1), max: Math.fround(100), noNaN: true }),
        price: fc.float({ min: Math.fround(50), max: Math.fround(200), noNaN: true }),
        slippageLimit: fc.float({ min: Math.fround(0.1), max: Math.fround(10), noNaN: true }),
        venue1Latency: fc.integer({ min: 10, max: 500 }),
        venue2Latency: fc.integer({ min: 10, max: 500 }),
        venue1ErrorRate: fc.float({ min: Math.fround(0), max: Math.fround(0.5), noNaN: true }),
        venue2ErrorRate: fc.float({ min: Math.fround(0), max: Math.fround(0.5), noNaN: true }),
        venue1Status: fc.constantFrom('healthy', 'degraded', 'offline') as fc.Arbitrary<'healthy' | 'degraded' | 'offline'>,
        venue2Status: fc.constantFrom('healthy', 'degraded', 'offline') as fc.Arbitrary<'healthy' | 'degraded' | 'offline'>
      }),
      async ({ symbol, side, quantity, price, slippageLimit, venue1Latency, venue2Latency, venue1ErrorRate, venue2ErrorRate, venue1Status, venue2Status }) => {
        // Configure venue conditions
        mockConnector1.setStatus({
          status: venue1Status,
          latency: venue1Latency,
          errorRate: venue1ErrorRate
        });

        mockConnector2.setStatus({
          status: venue2Status,
          latency: venue2Latency,
          errorRate: venue2ErrorRate
        });

        // Set up market data - both venues have same prices for fair comparison
        const orderBook = {
          bids: [{ price: price * 0.99, quantity: 1000 }],
          asks: [{ price: price * 1.01, quantity: 1000 }],
          timestamp: new Date()
        };
        
        mockConnector1.setOrderBook(orderBook);
        mockConnector2.setOrderBook(orderBook);

        // Disable slippage protection to focus on venue selection
        tradingEngine.updateSlippageGuardConfig({
          maxSlippagePercent: 100,
          enableSlippageProtection: false
        });

        // Determine which venue should be selected based on scoring logic
        let expectedVenue: string | null = null;
        let venue1Score = 0;
        let venue2Score = 0;
        
        // Only consider venues that are not offline
        const venue1Available = venue1Status !== 'offline';
        const venue2Available = venue2Status !== 'offline';
        
        if (!venue1Available && !venue2Available) {
          // Both offline - should fail
          expectedVenue = null;
        } else if (venue1Available && !venue2Available) {
          // Only venue1 available
          expectedVenue = 'venue1';
        } else if (!venue1Available && venue2Available) {
          // Only venue2 available
          expectedVenue = 'venue2';
        } else {
          // Both available - calculate scores
          // Health status scoring
          if (venue1Status === 'healthy') venue1Score += 40;
          else if (venue1Status === 'degraded') venue1Score += 20;
          
          if (venue2Status === 'healthy') venue2Score += 40;
          else if (venue2Status === 'degraded') venue2Score += 20;

          // Latency scoring (lower is better)
          venue1Score += Math.max(0, 20 - (venue1Latency / 100));
          venue2Score += Math.max(0, 20 - (venue2Latency / 100));

          // Error rate scoring (lower is better)
          venue1Score += Math.max(0, 20 - (venue1ErrorRate * 100));
          venue2Score += Math.max(0, 20 - (venue2ErrorRate * 100));

          // Liquidity scoring (both venues have same liquidity in our test)
          venue1Score += 20;
          venue2Score += 20;

          // Determine expected venue
          if (venue1Score > venue2Score) {
            expectedVenue = 'venue1';
          } else if (venue2Score > venue1Score) {
            expectedVenue = 'venue2';
          } else {
            // Tie - either venue could be selected
            expectedVenue = null; // We'll accept either
          }
        }

        try {
          const order = await tradingEngine.placeLimitOrder(symbol, side, quantity, price, slippageLimit);

          // Verify order was placed
          expect(order).toBeDefined();
          expect(order.venueId).toBeDefined();
          expect(['venue1', 'venue2']).toContain(order.venueId);

          // If we have a clear expected winner, verify it was selected
          if (expectedVenue && Math.abs(venue1Score - venue2Score) > 1) { // Only check when there's a clear winner
            expect(order.venueId).toBe(expectedVenue);
          }

          // Verify the selected venue is not offline
          const selectedVenueStatus = order.venueId === 'venue1' ? venue1Status : venue2Status;
          expect(selectedVenueStatus).not.toBe('offline');

        } catch (error) {
          // If all venues are offline, order should fail
          if (venue1Status === 'offline' && venue2Status === 'offline') {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('No healthy venues available');
          } else {
            // If at least one venue is available, order should not fail due to venue selection
            // Re-throw unexpected errors
            throw error;
          }
        }
      }
    ), { numRuns: 100 });
  });
});