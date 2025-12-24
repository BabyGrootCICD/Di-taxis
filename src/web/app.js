// Gold Router App Web UI JavaScript

class GoldRouterUI {
    constructor() {
        this.apiBaseUrl = '/api';
        this.portfolioService = null;
        this.tradingEngine = null;
        this.auditService = null;
        this.resilienceManager = null;
        this.refreshInterval = null;
        
        this.init();
    }

    async init() {
        // Initialize services (in a real implementation, these would be API calls)
        console.log('Initializing Gold Router UI...');
        
        // Start auto-refresh for portfolio data
        this.startAutoRefresh();
        
        // Load initial data
        await this.refreshPortfolio();
        await this.refreshSystemStatus();
        await this.refreshAuditLog();
    }

    // Tab Management
    showTab(tabName) {
        // Hide all tab contents
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Remove active class from all tabs
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => tab.classList.remove('active'));
        
        // Show selected tab content
        document.getElementById(tabName).classList.add('active');
        
        // Add active class to clicked tab
        event.target.classList.add('active');
        
        // Load tab-specific data
        switch(tabName) {
            case 'portfolio':
                this.refreshPortfolio();
                break;
            case 'trading':
                this.refreshOrderHistory();
                break;
            case 'audit':
                this.refreshAuditLog();
                break;
            case 'resilience':
                // Resilience tab doesn't need auto-refresh
                break;
        }
    }

    // Portfolio Management
    async refreshPortfolio() {
        try {
            // Simulate API call to portfolio service
            const portfolioData = await this.mockApiCall('/portfolio', {
                totalGrams: 125.75,
                venues: [
                    {
                        venueId: 'bitfinex',
                        venueName: 'Bitfinex',
                        holdings: [
                            { symbol: 'XAUt', balance: 2.5, gramsEquivalent: 77.76 },
                            { symbol: 'KAU', balance: 25.5, gramsEquivalent: 25.5 }
                        ],
                        status: 'healthy'
                    },
                    {
                        venueId: 'ethereum',
                        venueName: 'Ethereum',
                        holdings: [
                            { symbol: 'XAUt', balance: 0.75, gramsEquivalent: 23.33 }
                        ],
                        status: 'healthy'
                    }
                ],
                lastUpdated: new Date()
            });

            this.updatePortfolioDisplay(portfolioData);
        } catch (error) {
            this.showError('Failed to refresh portfolio: ' + error.message);
        }
    }

    updatePortfolioDisplay(portfolioData) {
        // Update total gold display
        document.getElementById('totalGold').textContent = `${portfolioData.totalGrams.toFixed(2)}g`;
        
        // Update venue list
        const venueList = document.getElementById('venueList');
        venueList.innerHTML = '';
        
        portfolioData.venues.forEach(venue => {
            const venueItem = document.createElement('li');
            venueItem.className = 'venue-item';
            
            const totalVenueGrams = venue.holdings.reduce((sum, holding) => sum + holding.gramsEquivalent, 0);
            
            venueItem.innerHTML = `
                <div>
                    <strong>${venue.venueName}</strong>
                    <div style="font-size: 0.9rem; color: #666;">
                        ${venue.holdings.map(h => `${h.balance} ${h.symbol}`).join(', ')}
                    </div>
                </div>
                <div>
                    <div style="font-weight: bold;">${totalVenueGrams.toFixed(2)}g</div>
                    <span class="venue-status status-${venue.status}">${venue.status}</span>
                </div>
            `;
            
            venueList.appendChild(venueItem);
        });
    }

    async refreshSystemStatus() {
        try {
            // Simulate API call to get system status
            const statusData = await this.mockApiCall('/health', {
                connectors: [
                    { name: 'Bitfinex', status: 'healthy', latency: 45 },
                    { name: 'Ethereum', status: 'healthy', latency: 120 },
                    { name: 'Audit Service', status: 'healthy', latency: 15 }
                ]
            });

            this.updateSystemStatusDisplay(statusData);
        } catch (error) {
            console.error('Failed to refresh system status:', error);
        }
    }

    updateSystemStatusDisplay(statusData) {
        const statusContainer = document.getElementById('systemStatus');
        statusContainer.innerHTML = '';
        
        statusData.connectors.forEach(connector => {
            const statusItem = document.createElement('div');
            statusItem.className = 'venue-item';
            statusItem.innerHTML = `
                <div>
                    <span class="status-indicator ${connector.status}"></span>
                    <strong>${connector.name}</strong>
                </div>
                <div>
                    <small>${connector.latency}ms</small>
                </div>
            `;
            statusContainer.appendChild(statusItem);
        });
    }

    // Trading Functions
    async placeOrder(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const orderData = {
            symbol: formData.get('symbol'),
            side: formData.get('side'),
            quantity: parseFloat(formData.get('quantity')),
            price: parseFloat(formData.get('price')),
            slippageLimit: parseFloat(formData.get('slippageLimit'))
        };

        try {
            this.showMessage('Placing order...', 'info');
            
            // Simulate API call to trading engine
            const result = await this.mockApiCall('/orders', {
                orderId: 'ord_' + Date.now(),
                status: 'filled',
                executedQuantity: orderData.quantity,
                executedPrice: orderData.price,
                timestamp: new Date()
            });

            this.showMessage(`Order placed successfully! Order ID: ${result.orderId}`, 'success');
            event.target.reset();
            await this.refreshOrderHistory();
            await this.refreshPortfolio(); // Refresh portfolio after trade
            
        } catch (error) {
            this.showMessage('Failed to place order: ' + error.message, 'error');
        }
    }

    async refreshOrderHistory() {
        try {
            // Simulate API call to get order history
            const orders = await this.mockApiCall('/orders/history', [
                {
                    orderId: 'ord_1234567890',
                    symbol: 'XAUt',
                    side: 'buy',
                    quantity: 1.0,
                    price: 2650.00,
                    status: 'filled',
                    timestamp: new Date(Date.now() - 3600000)
                },
                {
                    orderId: 'ord_1234567891',
                    symbol: 'KAU',
                    side: 'sell',
                    quantity: 5.0,
                    price: 85.50,
                    status: 'filled',
                    timestamp: new Date(Date.now() - 7200000)
                }
            ]);

            this.updateOrderHistoryDisplay(orders);
        } catch (error) {
            console.error('Failed to refresh order history:', error);
        }
    }

    updateOrderHistoryDisplay(orders) {
        const historyContainer = document.getElementById('orderHistory');
        
        if (orders.length === 0) {
            historyContainer.innerHTML = '<p>No orders found.</p>';
            return;
        }

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        
        table.innerHTML = `
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Order ID</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Symbol</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Side</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Quantity</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Price</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Status</th>
                    <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Time</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map(order => `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${order.orderId}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${order.symbol}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">
                            <span style="color: ${order.side === 'buy' ? '#28a745' : '#dc3545'};">
                                ${order.side.toUpperCase()}
                            </span>
                        </td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${order.quantity}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">$${order.price.toFixed(2)}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${order.status}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee;">${order.timestamp.toLocaleString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        
        historyContainer.innerHTML = '';
        historyContainer.appendChild(table);
    }

    // Audit Log Functions
    async refreshAuditLog() {
        try {
            // Simulate API call to audit service
            const auditEvents = await this.mockApiCall('/audit/logs', [
                {
                    eventId: 'evt_1234567890',
                    timestamp: new Date(Date.now() - 1800000),
                    eventType: 'TRADE_EXECUTION',
                    details: { symbol: 'XAUt', quantity: 1.0, price: 2650.00 },
                    signature: 'abc123...'
                },
                {
                    eventId: 'evt_1234567891',
                    timestamp: new Date(Date.now() - 3600000),
                    eventType: 'CREDENTIAL_STORAGE',
                    details: { venue: 'bitfinex', action: 'store' },
                    signature: 'def456...'
                },
                {
                    eventId: 'evt_1234567892',
                    timestamp: new Date(Date.now() - 5400000),
                    eventType: 'HEALTH_CHECK',
                    details: { connector: 'ethereum', status: 'healthy' },
                    signature: 'ghi789...'
                }
            ]);

            this.updateAuditLogDisplay(auditEvents);
        } catch (error) {
            console.error('Failed to refresh audit log:', error);
        }
    }

    updateAuditLogDisplay(auditEvents) {
        const logContainer = document.getElementById('auditLogContainer');
        logContainer.innerHTML = '';
        
        auditEvents.forEach(event => {
            const entry = document.createElement('div');
            entry.className = 'audit-entry';
            entry.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">
                    ${event.timestamp.toLocaleString()} - ${event.eventType}
                </div>
                <div style="margin-bottom: 5px;">
                    Event ID: ${event.eventId}
                </div>
                <div style="margin-bottom: 5px;">
                    Details: ${JSON.stringify(event.details)}
                </div>
                <div style="font-size: 0.8rem; color: #666;">
                    Signature: ${event.signature.substring(0, 20)}...
                </div>
            `;
            logContainer.appendChild(entry);
        });
    }

    async exportAuditLog() {
        try {
            // Simulate API call to export audit logs
            const exportData = await this.mockApiCall('/audit/export', {
                format: 'json',
                events: await this.mockApiCall('/audit/logs', [])
            });

            // Create downloadable file
            const dataStr = JSON.stringify(exportData.events, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            this.showMessage('Audit log exported successfully!', 'success');
        } catch (error) {
            this.showMessage('Failed to export audit log: ' + error.message, 'error');
        }
    }

    // Resilience Testing Functions
    async runHealthCheck() {
        try {
            this.showMessage('Running health checks...', 'info', 'resilience');
            
            // Simulate API call to resilience manager
            const healthResults = await this.mockApiCall('/resilience/health-check', {
                venues: [
                    { name: 'Bitfinex', status: 'healthy', latency: 45, lastCheck: new Date() },
                    { name: 'Ethereum', status: 'healthy', latency: 120, lastCheck: new Date() }
                ],
                overall: 'healthy'
            });

            this.displayResilienceResults('Health Check Results', healthResults);
            this.showMessage('Health check completed successfully!', 'success', 'resilience');
        } catch (error) {
            this.showMessage('Health check failed: ' + error.message, 'error', 'resilience');
        }
    }

    async simulateExchangeOutage() {
        try {
            this.showMessage('Simulating exchange outage...', 'info', 'resilience');
            
            // Simulate API call to resilience manager
            const outageResults = await this.mockApiCall('/resilience/simulate-outage', {
                simulatedVenue: 'bitfinex',
                fallbackRouting: 'enabled',
                affectedOrders: 0,
                status: 'simulation_complete'
            });

            this.displayResilienceResults('Exchange Outage Simulation', outageResults);
            this.showMessage('Exchange outage simulation completed!', 'success', 'resilience');
        } catch (error) {
            this.showMessage('Outage simulation failed: ' + error.message, 'error', 'resilience');
        }
    }

    async simulateChainCongestion() {
        try {
            this.showMessage('Simulating chain congestion...', 'info', 'resilience');
            
            // Simulate API call to resilience manager
            const congestionResults = await this.mockApiCall('/resilience/simulate-congestion', {
                chain: 'ethereum',
                originalThreshold: 12,
                adjustedThreshold: 24,
                estimatedDelay: '15-30 minutes',
                status: 'thresholds_adjusted'
            });

            this.displayResilienceResults('Chain Congestion Simulation', congestionResults);
            this.showMessage('Chain congestion simulation completed!', 'success', 'resilience');
        } catch (error) {
            this.showMessage('Congestion simulation failed: ' + error.message, 'error', 'resilience');
        }
    }

    async generateReadinessReport() {
        try {
            this.showMessage('Generating readiness report...', 'info', 'resilience');
            
            // Simulate API call to resilience manager
            const reportData = await this.mockApiCall('/resilience/readiness-report', {
                timestamp: new Date(),
                overallStatus: 'ready',
                venues: [
                    { name: 'Bitfinex', status: 'operational', failoverReady: true },
                    { name: 'Ethereum', status: 'operational', failoverReady: true }
                ],
                recommendations: [
                    'All systems operational',
                    'Failover mechanisms tested and ready',
                    'No immediate action required'
                ]
            });

            this.displayResilienceResults('Readiness Report', reportData);
            this.showMessage('Readiness report generated successfully!', 'success', 'resilience');
        } catch (error) {
            this.showMessage('Failed to generate readiness report: ' + error.message, 'error', 'resilience');
        }
    }

    displayResilienceResults(title, results) {
        const resultsContainer = document.getElementById('resilienceResults');
        
        const resultCard = document.createElement('div');
        resultCard.className = 'card';
        resultCard.style.marginTop = '20px';
        
        resultCard.innerHTML = `
            <h3>${title}</h3>
            <pre style="background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto;">
${JSON.stringify(results, null, 2)}
            </pre>
        `;
        
        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(resultCard);
    }

    // Utility Functions
    showMessage(message, type = 'info', context = 'trading') {
        const errorElement = document.getElementById(`${context}Error`);
        const successElement = document.getElementById(`${context}Success`);
        
        // Hide both messages first
        if (errorElement) errorElement.style.display = 'none';
        if (successElement) successElement.style.display = 'none';
        
        if (type === 'error') {
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.style.display = 'block';
            }
        } else if (type === 'success') {
            if (successElement) {
                successElement.textContent = message;
                successElement.style.display = 'block';
            }
        } else {
            console.log(message);
        }
    }

    startAutoRefresh() {
        // Refresh portfolio data every 30 seconds
        this.refreshInterval = setInterval(() => {
            if (document.getElementById('portfolio').classList.contains('active')) {
                this.refreshPortfolio();
                this.refreshSystemStatus();
            }
        }, 30000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Mock API call for demonstration purposes
    async mockApiCall(endpoint, mockData) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
        
        // Simulate occasional errors for testing
        if (Math.random() < 0.05) {
            throw new Error('Network error (simulated)');
        }
        
        return mockData;
    }
}

// Global functions for HTML event handlers
let goldRouterUI;

function showTab(tabName) {
    if (goldRouterUI) {
        goldRouterUI.showTab(tabName);
    }
}

function refreshPortfolio() {
    if (goldRouterUI) {
        goldRouterUI.refreshPortfolio();
    }
}

function placeOrder(event) {
    if (goldRouterUI) {
        goldRouterUI.placeOrder(event);
    }
}

function refreshAuditLog() {
    if (goldRouterUI) {
        goldRouterUI.refreshAuditLog();
    }
}

function exportAuditLog() {
    if (goldRouterUI) {
        goldRouterUI.exportAuditLog();
    }
}

function runHealthCheck() {
    if (goldRouterUI) {
        goldRouterUI.runHealthCheck();
    }
}

function simulateExchangeOutage() {
    if (goldRouterUI) {
        goldRouterUI.simulateExchangeOutage();
    }
}

function simulateChainCongestion() {
    if (goldRouterUI) {
        goldRouterUI.simulateChainCongestion();
    }
}

function generateReadinessReport() {
    if (goldRouterUI) {
        goldRouterUI.generateReadinessReport();
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    goldRouterUI = new GoldRouterUI();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (goldRouterUI) {
        goldRouterUI.stopAutoRefresh();
    }
});