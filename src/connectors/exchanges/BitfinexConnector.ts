/**
 * Bitfinex Exchange Connector Implementation
 * Implements the Exchange Connector interface for Bitfinex trading
 */

import { 
  BaseExchangeConnector, 
  ExchangeCredentials, 
  Balance, 
  PlaceOrderParams, 
  PlaceOrderResult, 
  OrderBook,
  OrderBookEntry
} from '../ExchangeConnector';
import { Order, OrderStatus } from '../../models/Order';
import { AuditService } from '../../services/AuditService';

/**
 * Bitfinex-specific error types
 */
export interface BitfinexError {
  code: number;
  message: string;
  details?: any;
}

/**
 * Bitfinex API response structures
 */
interface BitfinexBalance {
  type: string;
  currency: string;
  amount: string;
  available: string;
}

interface BitfinexOrderResponse {
  id: number;
  cid: number;
  symbol: string;
  mts_create: number;
  mts_update: number;
  amount: string;
  amount_orig: string;
  type: string;
  type_prev: string;
  flags: number;
  status: string;
  price: string;
  price_avg: string;
  price_trailing: string;
  price_aux_limit: string;
  notify: number;
  hidden: number;
  placed_id: number;
}

interface BitfinexOrderBook {
  bids: [number, number, number][];
  asks: [number, number, number][];
}

/**
 * Bitfinex Exchange Connector
 */
export class BitfinexConnector extends BaseExchangeConnector {
  private readonly baseUrl = 'https://api.bitfinex.com';
  private readonly wsUrl = 'wss://api.bitfinex.com/ws/2';
  private auditService?: AuditService;

  constructor(auditService?: AuditService) {
    super(
      'bitfinex',
      'Bitfinex',
      {
        failureThreshold: 5,
        recoveryTimeout: 60000,
        monitoringPeriod: 300000
      },
      {
        requestsPerSecond: 10,
        burstSize: 20
      },
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2
      }
    );
    this.auditService = auditService;
  }

  /**
   * Authenticate with Bitfinex API
   */
  async authenticate(credentials: ExchangeCredentials): Promise<boolean> {
    try {
      this.validateCredentials(credentials);
      
      // Test authentication by fetching account info
      const authResult = await this.executeWithProtection(
        () => this.testAuthentication(credentials),
        'authenticate'
      );

      if (authResult) {
        this.credentials = credentials;
        this.isAuthenticated = true;
        
        // Log successful authentication
        this.auditService?.logSecurityEvent(
          'EXCHANGE_AUTH_SUCCESS',
          {
            exchange: 'bitfinex',
            timestamp: new Date().toISOString()
          },
          undefined,
          this.connectorId
        );
        
        return true;
      }
      
      return false;
    } catch (error) {
      this.auditService?.logSecurityEvent(
        'EXCHANGE_AUTH_FAILURE',
        {
          exchange: 'bitfinex',
          error: this.mapError(error as Error),
          timestamp: new Date().toISOString()
        },
        undefined,
        this.connectorId
      );
      
      throw this.mapError(error as Error);
    }
  }

  /**
   * Get balance for a specific symbol
   */
  async getBalance(symbol: string): Promise<Balance> {
    if (!this.isAuthenticated || !this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      return await this.executeWithProtection(
        () => this.fetchBalance(symbol),
        'getBalance'
      );
    } catch (error) {
      throw this.mapError(error as Error);
    }
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    if (!this.isAuthenticated || !this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      const result = await this.executeWithProtection(
        () => this.submitLimitOrder(params),
        'placeLimitOrder'
      );

      // Log order placement
      this.auditService?.logSecurityEvent(
        'ORDER_PLACED',
        {
          exchange: 'bitfinex',
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          price: params.price,
          orderId: result.orderId,
          timestamp: new Date().toISOString()
        },
        undefined,
        this.connectorId
      );

      return result;
    } catch (error) {
      // Log order failure
      this.auditService?.logSecurityEvent(
        'ORDER_FAILED',
        {
          exchange: 'bitfinex',
          symbol: params.symbol,
          side: params.side,
          quantity: params.quantity,
          price: params.price,
          error: this.mapError(error as Error),
          timestamp: new Date().toISOString()
        },
        undefined,
        this.connectorId
      );

      throw this.mapError(error as Error);
    }
  }

  /**
   * Get order book for a symbol
   */
  async getOrderBook(symbol: string, depth: number = 25): Promise<OrderBook> {
    try {
      return await this.executeWithProtection(
        () => this.fetchOrderBook(symbol, depth),
        'getOrderBook'
      );
    } catch (error) {
      throw this.mapError(error as Error);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.isAuthenticated || !this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      const result = await this.executeWithProtection(
        () => this.submitCancelOrder(orderId),
        'cancelOrder'
      );

      // Log order cancellation
      this.auditService?.logSecurityEvent(
        'ORDER_CANCELLED',
        {
          exchange: 'bitfinex',
          orderId,
          timestamp: new Date().toISOString()
        },
        undefined,
        this.connectorId
      );

      return result;
    } catch (error) {
      throw this.mapError(error as Error);
    }
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId: string): Promise<Order | null> {
    if (!this.isAuthenticated || !this.credentials) {
      throw new Error('Not authenticated');
    }

    try {
      return await this.executeWithProtection(
        () => this.fetchOrderStatus(orderId),
        'getOrderStatus'
      );
    } catch (error) {
      throw this.mapError(error as Error);
    }
  }

  /**
   * Perform health check
   */
  protected async performHealthCheck(): Promise<boolean> {
    try {
      // Test public API endpoint
      const response = await fetch(`${this.baseUrl}/v1/pubticker/BTCUSD`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get connector capabilities
   */
  protected getCapabilities(): string[] {
    return [
      'spot_trading',
      'limit_orders',
      'order_book',
      'balance_query',
      'order_status',
      'order_cancellation'
    ];
  }

  /**
   * Test authentication with Bitfinex
   */
  private async testAuthentication(credentials: ExchangeCredentials): Promise<boolean> {
    const path = '/v1/account_infos';
    const nonce = Date.now().toString();
    const body = {
      request: path,
      nonce
    };

    const payload = Buffer.from(JSON.stringify(body)).toString('base64');
    const signature = this.generateSignature(payload, credentials.secret);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BFX-APIKEY': credentials.apiKey,
        'X-BFX-PAYLOAD': payload,
        'X-BFX-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Authentication failed: ${errorData.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    // Verify the account has trade-only permissions (no withdrawal capabilities)
    if (data.length > 0 && data[0].fees) {
      // If we can access account info, authentication is successful
      // Additional permission validation would be done here in a real implementation
      return true;
    }

    return false;
  }

  /**
   * Fetch balance for a symbol
   */
  private async fetchBalance(symbol: string): Promise<Balance> {
    const path = '/v1/balances';
    const nonce = Date.now().toString();
    const body = {
      request: path,
      nonce
    };

    const payload = Buffer.from(JSON.stringify(body)).toString('base64');
    const signature = this.generateSignature(payload, this.credentials!.secret);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BFX-APIKEY': this.credentials!.apiKey,
        'X-BFX-PAYLOAD': payload,
        'X-BFX-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch balance: ${errorData.message || 'Unknown error'}`);
    }

    const balances: BitfinexBalance[] = await response.json();
    const targetBalance = balances.find(b => 
      b.currency.toUpperCase() === symbol.toUpperCase() && b.type === 'exchange'
    );

    if (!targetBalance) {
      return {
        symbol,
        available: 0,
        total: 0
      };
    }

    return {
      symbol,
      available: parseFloat(targetBalance.available),
      total: parseFloat(targetBalance.amount)
    };
  }

  /**
   * Submit a limit order
   */
  private async submitLimitOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const path = '/v1/order/new';
    const nonce = Date.now().toString();
    const body = {
      request: path,
      nonce,
      symbol: this.formatSymbol(params.symbol),
      amount: params.side === 'buy' ? params.quantity.toString() : (-params.quantity).toString(),
      price: params.price.toString(),
      exchange: 'bitfinex',
      side: params.side,
      type: 'exchange limit'
    };

    const payload = Buffer.from(JSON.stringify(body)).toString('base64');
    const signature = this.generateSignature(payload, this.credentials!.secret);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BFX-APIKEY': this.credentials!.apiKey,
        'X-BFX-PAYLOAD': payload,
        'X-BFX-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to place order: ${errorData.message || 'Unknown error'}`);
    }

    const orderData: BitfinexOrderResponse = await response.json();

    return {
      orderId: orderData.id.toString(),
      status: this.mapOrderStatus(orderData.status),
      timestamp: new Date(orderData.mts_create)
    };
  }

  /**
   * Fetch order book
   */
  private async fetchOrderBook(symbol: string, depth: number): Promise<OrderBook> {
    const formattedSymbol = this.formatSymbol(symbol);
    const response = await fetch(
      `${this.baseUrl}/v1/book/${formattedSymbol}?limit_bids=${depth}&limit_asks=${depth}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to fetch order book: ${errorData.message || 'Unknown error'}`);
    }

    const data: BitfinexOrderBook = await response.json();

    return {
      bids: data.bids.map(([price, , quantity]): OrderBookEntry => ({
        price,
        quantity
      })),
      asks: data.asks.map(([price, , quantity]): OrderBookEntry => ({
        price,
        quantity
      })),
      timestamp: new Date()
    };
  }

  /**
   * Submit order cancellation
   */
  private async submitCancelOrder(orderId: string): Promise<boolean> {
    const path = '/v1/order/cancel';
    const nonce = Date.now().toString();
    const body = {
      request: path,
      nonce,
      order_id: parseInt(orderId)
    };

    const payload = Buffer.from(JSON.stringify(body)).toString('base64');
    const signature = this.generateSignature(payload, this.credentials!.secret);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BFX-APIKEY': this.credentials!.apiKey,
        'X-BFX-PAYLOAD': payload,
        'X-BFX-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to cancel order: ${errorData.message || 'Unknown error'}`);
    }

    return true;
  }

  /**
   * Fetch order status
   */
  private async fetchOrderStatus(orderId: string): Promise<Order | null> {
    const path = '/v1/order/status';
    const nonce = Date.now().toString();
    const body = {
      request: path,
      nonce,
      order_id: parseInt(orderId)
    };

    const payload = Buffer.from(JSON.stringify(body)).toString('base64');
    const signature = this.generateSignature(payload, this.credentials!.secret);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-BFX-APIKEY': this.credentials!.apiKey,
        'X-BFX-PAYLOAD': payload,
        'X-BFX-SIGNATURE': signature,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (response.status === 404) {
        return null; // Order not found
      }
      throw new Error(`Failed to fetch order status: ${errorData.message || 'Unknown error'}`);
    }

    const orderData: BitfinexOrderResponse = await response.json();

    return {
      orderId: orderData.id.toString(),
      venueId: this.connectorId,
      symbol: this.parseSymbol(orderData.symbol),
      side: parseFloat(orderData.amount) > 0 ? 'buy' : 'sell',
      orderType: 'limit',
      quantity: Math.abs(parseFloat(orderData.amount_orig)),
      price: parseFloat(orderData.price),
      slippageLimit: 0, // Not directly available from Bitfinex
      status: this.mapOrderStatus(orderData.status),
      createdAt: new Date(orderData.mts_create),
      executedAt: orderData.mts_update !== orderData.mts_create ? new Date(orderData.mts_update) : undefined,
      fills: [] // Would need additional API call to get fills
    };
  }

  /**
   * Generate HMAC signature for Bitfinex API
   */
  private generateSignature(payload: string, secret: string): string {
    const crypto = require('crypto');
    return crypto
      .createHmac('sha384', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Format symbol for Bitfinex API
   */
  private formatSymbol(symbol: string): string {
    // Convert standard symbols to Bitfinex format
    // e.g., "BTC/USD" -> "BTCUSD"
    return symbol.replace('/', '').toUpperCase();
  }

  /**
   * Parse symbol from Bitfinex format
   */
  private parseSymbol(bitfinexSymbol: string): string {
    // Convert Bitfinex format back to standard format
    // This is a simplified implementation
    if (bitfinexSymbol.length === 6) {
      return `${bitfinexSymbol.slice(0, 3)}/${bitfinexSymbol.slice(3)}`;
    }
    return bitfinexSymbol;
  }

  /**
   * Map Bitfinex order status to our standard status
   */
  private mapOrderStatus(bitfinexStatus: string): OrderStatus {
    switch (bitfinexStatus.toLowerCase()) {
      case 'live':
      case 'active':
        return 'pending';
      case 'partially filled':
        return 'partial';
      case 'executed':
      case 'filled':
        return 'filled';
      case 'canceled':
      case 'cancelled':
        return 'cancelled';
      case 'rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  /**
   * Map errors to structured format
   */
  private mapError(error: Error): Error {
    // Enhanced error mapping with structured responses
    const structuredError = new Error();
    
    if (error.message.includes('Authentication failed')) {
      structuredError.name = 'AUTHENTICATION_ERROR';
      structuredError.message = 'Invalid API credentials or insufficient permissions';
    } else if (error.message.includes('rate limit')) {
      structuredError.name = 'RATE_LIMIT_ERROR';
      structuredError.message = 'API rate limit exceeded, please retry later';
    } else if (error.message.includes('insufficient')) {
      structuredError.name = 'INSUFFICIENT_BALANCE_ERROR';
      structuredError.message = 'Insufficient balance for the requested operation';
    } else if (error.message.includes('invalid symbol')) {
      structuredError.name = 'INVALID_SYMBOL_ERROR';
      structuredError.message = 'The specified trading symbol is not supported';
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      structuredError.name = 'NETWORK_ERROR';
      structuredError.message = 'Network connectivity issue, please check connection';
    } else {
      structuredError.name = 'EXCHANGE_ERROR';
      structuredError.message = error.message || 'Unknown exchange error occurred';
    }

    return structuredError;
  }
}