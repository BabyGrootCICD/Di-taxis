import React, { useState, useEffect } from 'react';
import { TradingEngine } from '../../services/TradingEngine';
import { AuditService } from '../../services/AuditService';
import { Order } from '../../models/Order';

interface TradingInterfaceProps {
  tradingEngine: TradingEngine;
  auditService: AuditService;
}

interface OrderForm {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  slippageLimit: string;
}

export const TradingInterface: React.FC<TradingInterfaceProps> = ({
  tradingEngine,
  auditService
}) => {
  const [orderForm, setOrderForm] = useState<OrderForm>({
    symbol: 'XAUt',
    side: 'buy',
    quantity: '',
    price: '',
    slippageLimit: '1.0'
  });
  
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    loadOrderHistory();
  }, [tradingEngine]);

  const loadOrderHistory = async () => {
    try {
      // In a real implementation, this would call tradingEngine.getOrderHistory()
      // For now, we'll simulate with empty array
      setOrderHistory([]);
    } catch (error) {
      console.error('Failed to load order history:', error);
    }
  };

  const handleInputChange = (field: keyof OrderForm, value: string) => {
    setOrderForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const validateForm = (): string | null => {
    if (!orderForm.quantity || parseFloat(orderForm.quantity) <= 0) {
      return 'Quantity must be greater than 0';
    }
    
    if (!orderForm.price || parseFloat(orderForm.price) <= 0) {
      return 'Price must be greater than 0';
    }
    
    if (!orderForm.slippageLimit || parseFloat(orderForm.slippageLimit) < 0 || parseFloat(orderForm.slippageLimit) > 10) {
      return 'Slippage limit must be between 0 and 10%';
    }
    
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validationError = validateForm();
    if (validationError) {
      setMessage({ text: validationError, type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage({ text: 'Placing order...', type: 'info' });

    try {
      const orderParams = {
        symbol: orderForm.symbol,
        side: orderForm.side,
        quantity: parseFloat(orderForm.quantity),
        price: parseFloat(orderForm.price),
        slippageLimit: parseFloat(orderForm.slippageLimit)
      };

      // In a real implementation, this would call tradingEngine.placeLimitOrder()
      // For now, we'll simulate the order placement
      const orderId = `ord_${Date.now()}`;
      
      // Log the trade execution to audit service
      await auditService.logTradeExecution(
        orderParams,
        { orderId, status: 'submitted', timestamp: new Date() }
      );

      setMessage({ 
        text: `Order placed successfully! Order ID: ${orderId}`, 
        type: 'success' 
      });
      
      // Reset form
      setOrderForm({
        symbol: 'XAUt',
        side: 'buy',
        quantity: '',
        price: '',
        slippageLimit: '1.0'
      });
      
      // Reload order history
      await loadOrderHistory();
      
    } catch (error) {
      setMessage({ 
        text: `Failed to place order: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        type: 'error' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearMessage = () => {
    setMessage(null);
  };

  return (
    <div className="trading-interface">
      <div className="trading-content">
        <div className="order-form-section">
          <div className="card">
            <h2>Place Order</h2>
            
            {message && (
              <div className={`message message-${message.type}`}>
                {message.text}
                <button onClick={clearMessage} className="message-close">×</button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="order-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="symbol">Symbol</label>
                  <select
                    id="symbol"
                    value={orderForm.symbol}
                    onChange={(e) => handleInputChange('symbol', e.target.value)}
                    required
                  >
                    <option value="XAUt">XAUt (Tether Gold)</option>
                    <option value="KAU">KAU (Kinesis Gold)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="side">Side</label>
                  <select
                    id="side"
                    value={orderForm.side}
                    onChange={(e) => handleInputChange('side', e.target.value as 'buy' | 'sell')}
                    required
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="quantity">Quantity</label>
                  <input
                    type="number"
                    id="quantity"
                    value={orderForm.quantity}
                    onChange={(e) => handleInputChange('quantity', e.target.value)}
                    step="0.001"
                    min="0.001"
                    placeholder="0.000"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="price">Price (USD)</label>
                  <input
                    type="number"
                    id="price"
                    value={orderForm.price}
                    onChange={(e) => handleInputChange('price', e.target.value)}
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="slippageLimit">Slippage Limit (%)</label>
                <input
                  type="number"
                  id="slippageLimit"
                  value={orderForm.slippageLimit}
                  onChange={(e) => handleInputChange('slippageLimit', e.target.value)}
                  step="0.1"
                  min="0.1"
                  max="10"
                  required
                />
              </div>

              <button 
                type="submit" 
                className="btn btn-primary btn-large"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Placing Order...' : 'Place Order'}
              </button>
            </form>
          </div>
        </div>

        <div className="order-history-section">
          <div className="card">
            <h2>Order History</h2>
            
            {orderHistory.length === 0 ? (
              <div className="empty-state">
                <p>No orders found.</p>
                <p>Place your first order to see it here.</p>
              </div>
            ) : (
              <div className="order-history-table">
                <table>
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Quantity</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistory.map((order) => (
                      <tr key={order.orderId}>
                        <td className="order-id">{order.orderId}</td>
                        <td>{order.symbol}</td>
                        <td>
                          <span className={`side-badge side-${order.side}`}>
                            {order.side.toUpperCase()}
                          </span>
                        </td>
                        <td>{order.quantity.toFixed(4)}</td>
                        <td>${order.price.toFixed(2)}</td>
                        <td>
                          <span className={`status-badge status-${order.status}`}>
                            {order.status}
                          </span>
                        </td>
                        <td>{order.createdAt.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};