/**
 * Order and trading data models
 */

export type OrderStatus = 'pending' | 'partial' | 'filled' | 'cancelled' | 'rejected';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit';

export interface Fill {
  fillId: string;
  quantity: number;
  price: number;
  timestamp: Date;
  fees: number;
}

export interface Order {
  orderId: string;
  venueId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number;
  slippageLimit: number;
  status: OrderStatus;
  createdAt: Date;
  executedAt?: Date;
  fills: Fill[];
}