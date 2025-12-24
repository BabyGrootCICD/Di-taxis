const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Simple HTTP server for the Gold Router Web UI
 */
class WebServer {
  constructor(port = 3000) {
    this.port = port;
    this.webRoot = __dirname; // src/web directory
    
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  async handleRequest(req, res) {
    const url = req.url || '/';
    const method = req.method || 'GET';

    try {
      // Handle API routes
      if (url.startsWith('/api/')) {
        await this.handleApiRequest(req, res);
        return;
      }

      // Handle static file requests
      await this.handleStaticRequest(url, res);
      
    } catch (error) {
      console.error('Server error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Internal server error',
        message: error.message || 'Unknown error'
      }));
    }
  }

  async handleApiRequest(req, res) {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse request body for POST requests
    let body = '';
    if (method === 'POST' || method === 'PUT') {
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      await new Promise((resolve) => {
        req.on('end', resolve);
      });
    }

    // Route API requests with mock data
    try {
      let response;
      
      if (url === '/api/health' && method === 'GET') {
        response = {
          status: 'healthy',
          timestamp: new Date(),
          components: {
            portfolio: { status: 'healthy', lastCheck: new Date() },
            audit: { status: 'healthy', lastCheck: new Date() },
            trading: { status: 'healthy', lastCheck: new Date() }
          }
        };
      } else if (url === '/api/portfolio' && method === 'GET') {
        response = {
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
        };
      } else if (url === '/api/connectors' && method === 'GET') {
        response = [
          { name: 'Bitfinex', status: 'healthy', latency: 45 },
          { name: 'Ethereum', status: 'healthy', latency: 120 },
          { name: 'Audit Service', status: 'healthy', latency: 15 }
        ];
      } else if (url === '/api/audit/logs' && method === 'GET') {
        response = [
          {
            eventId: 'evt_1234567890',
            timestamp: new Date(Date.now() - 1800000),
            eventType: 'TRADE_EXECUTION',
            details: { symbol: 'XAUt', quantity: 1.0, price: 2650.00 },
            signature: 'abc123def456ghi789'
          },
          {
            eventId: 'evt_1234567891',
            timestamp: new Date(Date.now() - 3600000),
            eventType: 'CREDENTIAL_STORAGE',
            details: { venue: 'bitfinex', action: 'store' },
            signature: 'def456ghi789jkl012'
          }
        ];
      } else if (url === '/api/orders' && method === 'POST') {
        const orderData = JSON.parse(body);
        response = { orderId: `ord_${Date.now()}`, status: 'submitted', ...orderData };
      } else if (url === '/api/orders/history' && method === 'GET') {
        response = [];
      } else if (url === '/api/resilience/health-check' && method === 'POST') {
        response = {
          venues: [
            { name: 'Bitfinex', status: 'healthy', latency: 45 },
            { name: 'Ethereum', status: 'healthy', latency: 120 }
          ],
          overall: 'healthy'
        };
      } else if (url === '/api/resilience/simulate-outage' && method === 'POST') {
        response = {
          simulatedVenue: 'bitfinex',
          fallbackRouting: 'enabled',
          status: 'simulation_complete'
        };
      } else if (url === '/api/resilience/simulate-congestion' && method === 'POST') {
        response = {
          chain: 'ethereum',
          originalThreshold: 12,
          adjustedThreshold: 24,
          status: 'thresholds_adjusted'
        };
      } else if (url === '/api/resilience/readiness-report' && method === 'POST') {
        response = {
          timestamp: new Date(),
          overallStatus: 'ready',
          venues: [
            { name: 'Bitfinex', status: 'operational', failoverReady: true },
            { name: 'Ethereum', status: 'operational', failoverReady: true }
          ]
        };
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'API error',
        message: error.message || 'Unknown error'
      }));
    }
  }

  async handleStaticRequest(url, res) {
    // Default to index.html for root requests
    if (url === '/' || url === '/index.html') {
      url = '/index.html';
    } else if (url === '/react' || url === '/react.html') {
      url = '/react-app.html';
    }

    const filePath = path.join(this.webRoot, url);
    
    // Security check - ensure file is within web root
    if (!filePath.startsWith(this.webRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = this.getContentType(ext);
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading file');
    }
  }

  getContentType(ext) {
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    
    return contentTypes[ext] || 'text/plain';
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🥇 Gold Router Web UI server running at http://localhost:${this.port}`);
        console.log(`📊 Portfolio view: http://localhost:${this.port}/`);
        console.log(`⚛️  React version: http://localhost:${this.port}/react`);
        console.log(`🔧 API endpoints: http://localhost:${this.port}/api/health`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('Web server stopped');
        resolve();
      });
    });
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new WebServer(3001);
  server.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down web server...');
    await server.stop();
    process.exit(0);
  });
}

module.exports = { WebServer };