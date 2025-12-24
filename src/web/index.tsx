import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { PortfolioService } from '../services/PortfolioService';
import { TradingEngine } from '../services/TradingEngine';
import { AuditService } from '../services/AuditService';
import { ResilienceManager } from '../services/ResilienceManager';
import { SecurityManager } from '../security/SecurityManager';

/**
 * Initialize and start the Gold Router Web UI
 */
async function initializeApp() {
  try {
    // Initialize core services
    const securityManager = new SecurityManager();
    const auditService = new AuditService();
    const portfolioService = new PortfolioService();
    const tradingEngine = new TradingEngine(auditService);
    const resilienceManager = new ResilienceManager();

    // Log application startup
    await auditService.logSecurityEvent(
      'APPLICATION_STARTUP',
      { 
        component: 'web-ui',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    );

    // Get the root element
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Root element not found');
    }

    // Create React root and render the app
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App
          portfolioService={portfolioService}
          tradingEngine={tradingEngine}
          auditService={auditService}
          resilienceManager={resilienceManager}
        />
      </React.StrictMode>
    );

    console.log('Gold Router Web UI initialized successfully');

  } catch (error) {
    console.error('Failed to initialize Gold Router Web UI:', error);
    
    // Show error message to user
    const container = document.getElementById('root');
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          padding: 20px;
          text-align: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">
          <h1 style="color: #dc3545; margin-bottom: 20px;">
            🚨 Application Error
          </h1>
          <p style="color: #666; margin-bottom: 20px; max-width: 500px;">
            Failed to initialize the Gold Router application. Please check the console for details and try refreshing the page.
          </p>
          <button 
            onclick="window.location.reload()" 
            style="
              padding: 12px 24px;
              background: #ffd700;
              color: #333;
              border: none;
              border-radius: 6px;
              font-size: 1rem;
              font-weight: 500;
              cursor: pointer;
            "
          >
            Reload Application
          </button>
          <details style="margin-top: 20px; max-width: 600px;">
            <summary style="cursor: pointer; color: #666;">Error Details</summary>
            <pre style="
              background: #f8f9fa;
              padding: 15px;
              border-radius: 4px;
              text-align: left;
              margin-top: 10px;
              overflow-x: auto;
              font-size: 0.9rem;
            ">${error instanceof Error ? error.stack : String(error)}</pre>
          </details>
        </div>
      `;
    }
  }
}

// Initialize the application when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Handle unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

export { initializeApp };