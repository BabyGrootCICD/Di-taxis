/**
 * Property-based tests for Bitfinex Connector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BitfinexConnector } from './BitfinexConnector';
import { AuditService } from '../../services/AuditService';
import { PlaceOrderParams, ExchangeCredentials } from '../ExchangeConnector';
import { OrderSide } from '../../models/Order';

// Mock fetch for testing
global.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
  const urlStr = url.toString();
  
  // Mock successful authentication
  if (urlStr.includes('/v1/account_infos')) {
    return new Response(JSON.stringify([{ fees: [] }]), { status: 200 });
  }
  
  // Mock health check
  if (urlStr.includes('/v1/pubticker/BTCUSD')) {
    return new Response(JSON.stringify({ last_price: "50000" }), { status: 200 });
  }
  
  // Mock order placement
  if (urlStr.includes('/v1/order/new')) {
    // Parse the request body to get the order details
    const body = options?.body ? JSON.parse(Buffer.from(options.body as string, 'base64').toString()) : {};
    const amount = parseFloat(body.amount || '0.1');
    const side = amount > 0 ? 'buy' : 'sell';
    
    return new Response(JSON.stringify({
      id: 12345,
      cid: 67890,
      symbol: 'BTCUSD',
      mts_create: Date.now(),
      mts_update: Date.now(),
      amount: body.amount || '0.1',
      amount_orig: body.amount || '0.1',
      type: 'exchange limit',
      status: 'live',
      price: body.price || '50000'
    }), { status: 200 });
  }
  
  return new Response('Not Found', { status: 404 });
};

describe('Bitfinex Connector Property Tests', () => {
  let connector: BitfinexConnector;
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService();
    connector = new BitfinexConnector(auditService);
  });

  /**
   * **Feature: gold-router-app, Property 11: Orders route to appropriate connectors**
   * **Validates: Requirements 3.1**
   */
  it('Property 11: Orders route to appropriate connectors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          symbol: fc.constantFrom('BTC/USD', 'ETH/USD'),
          side: fc.constantFrom('buy', 'sell') as fc.Arbitrary<OrderSide>,
          quantity: fc.float({ min: Math.fround(0.1), max: Math.fround(1), noNaN: true }),
          price: fc.float({ min: Math.fround(1000), max: Math.fround(10000), noNaN: true })
        }),
        async (orderParams) => {
          // Use valid credentials for this test
          const validCredentials: ExchangeCredentials = {
            apiKey: 'valid_api_key_12345678901234567890',
            secret: 'valid_secret_12345678901234567890'
          };
          
          // Authenticate first
          const authResult = await connector.authenticate(validCredentials);
          expect(authResult).toBe(true);
          
          // Create order parameters
          const placeOrderParams: PlaceOrderParams = {
            symbol: orderParams.symbol,
            side: orderParams.side,
            quantity: orderParams.quantity,
            price: orderParams.price,
            orderType: 'limit'
          };
          
          // Place the order
          const result = await connector.placeLimitOrder(placeOrderParams);
          
          // Verify the order was routed to the Bitfinex connector
          expect(result.orderId).toBeDefined();
          expect(result.status).toBeDefined();
          expect(result.timestamp).toBeInstanceOf(Date);
          
          // Verify the connector status shows it's handling the order
          const status = connector.getStatus();
          expect(status.connectorId).toBe('bitfinex');
          expect(status.name).toBe('Bitfinex');
          expect(status.connectorType).toBe('exchange');
          
          // Verify audit logging occurred (order routing was logged)
          const auditEvents = auditService.getAllEvents();
          const orderPlacedEvent = auditEvents.find(event => 
            event.eventType === 'ORDER_PLACED' && 
            event.venueId === 'bitfinex'
          );
          expect(orderPlacedEvent).toBeDefined();
          // The key property is that the order was routed to the bitfinex connector
          expect(orderPlacedEvent?.venueId).toBe('bitfinex');
          expect(orderPlacedEvent?.details.exchange).toBe('bitfinex');
        }
      ),
      { numRuns: 10, timeout: 10000 }
    );
  });

  /**
   * **Feature: gold-router-app, Property 38: Errors provide structured responses**
   * **Validates: Requirements 8.4**
   */
  it('Property 38: Errors provide structured responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          apiKey: fc.string({ minLength: 1, maxLength: 5 }), // Invalid short key
          secret: fc.string({ minLength: 1, maxLength: 5 })  // Invalid short secret
        }),
        async (invalidCredentials) => {
          try {
            await connector.authenticate(invalidCredentials);
            // Should not reach here
            expect(false).toBe(true);
          } catch (error) {
            // Verify error has structured format
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).name).toBeDefined();
            expect((error as Error).message).toBeDefined();
            
            // Verify error name follows structured format
            const errorName = (error as Error).name;
            expect(errorName).toMatch(/^[A-Z_]+_ERROR$/);
            
            // Verify error message is descriptive
            const errorMessage = (error as Error).message;
            expect(errorMessage.length).toBeGreaterThan(10);
            expect(errorMessage).not.toBe('');
            
            // Verify audit logging of the error
            const auditEvents = auditService.getAllEvents();
            const authFailureEvent = auditEvents.find(event => 
              event.eventType === 'EXCHANGE_AUTH_FAILURE'
            );
            expect(authFailureEvent).toBeDefined();
            expect(authFailureEvent?.details.exchange).toBe('bitfinex');
          }
        }
      ),
      { numRuns: 10, timeout: 5000 }
    );
  });
});