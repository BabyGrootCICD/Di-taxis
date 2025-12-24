import React, { useState, useEffect } from 'react';
import { PortfolioView } from './PortfolioView';
import { TradingInterface } from './TradingInterface';
import { AuditLogViewer } from './AuditLogViewer';
import { ResilienceTestInterface } from './ResilienceTestInterface';
import { PortfolioService } from '../../services/PortfolioService';
import { TradingEngine } from '../../services/TradingEngine';
import { AuditService } from '../../services/AuditService';
import { ResilienceManager } from '../../services/ResilienceManager';
import './App.css';

type TabType = 'portfolio' | 'trading' | 'audit' | 'resilience';

interface AppProps {
  portfolioService: PortfolioService;
  tradingEngine: TradingEngine;
  auditService: AuditService;
  resilienceManager: ResilienceManager;
}

export const App: React.FC<AppProps> = ({
  portfolioService,
  tradingEngine,
  auditService,
  resilienceManager
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('portfolio');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize the application
    const initializeApp = async () => {
      try {
        setIsLoading(true);
        // Perform any necessary initialization
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate initialization
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize application');
        setIsLoading(false);
      }
    };

    initializeApp();
  }, []);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setError(null); // Clear any existing errors when switching tabs
  };

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Initializing Gold Router App...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <h2>Application Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Reload Application</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🥇 Gold Router App</h1>
        <p>Non-custodial gold-backed token trading and portfolio management</p>
      </header>

      <nav className="app-nav">
        <button
          className={`nav-tab ${activeTab === 'portfolio' ? 'active' : ''}`}
          onClick={() => handleTabChange('portfolio')}
        >
          Portfolio
        </button>
        <button
          className={`nav-tab ${activeTab === 'trading' ? 'active' : ''}`}
          onClick={() => handleTabChange('trading')}
        >
          Trading
        </button>
        <button
          className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => handleTabChange('audit')}
        >
          Audit Logs
        </button>
        <button
          className={`nav-tab ${activeTab === 'resilience' ? 'active' : ''}`}
          onClick={() => handleTabChange('resilience')}
        >
          Resilience Testing
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'portfolio' && (
          <PortfolioView portfolioService={portfolioService} />
        )}
        {activeTab === 'trading' && (
          <TradingInterface 
            tradingEngine={tradingEngine}
            auditService={auditService}
          />
        )}
        {activeTab === 'audit' && (
          <AuditLogViewer auditService={auditService} />
        )}
        {activeTab === 'resilience' && (
          <ResilienceTestInterface 
            resilienceManager={resilienceManager}
            auditService={auditService}
          />
        )}
      </main>
    </div>
  );
};