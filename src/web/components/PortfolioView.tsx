import React, { useState, useEffect } from 'react';
import { PortfolioService } from '../../services/PortfolioService';
import { Portfolio, VenueHolding } from '../../models/Portfolio';

interface PortfolioViewProps {
  portfolioService: PortfolioService;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({ portfolioService }) => {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    refreshPortfolio();
    
    // Set up auto-refresh every 30 seconds
    const interval = setInterval(refreshPortfolio, 30000);
    
    return () => clearInterval(interval);
  }, [portfolioService]);

  const refreshPortfolio = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const portfolioData = await portfolioService.getPortfolio();
      setPortfolio(portfolioData);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'healthy': return '#28a745';
      case 'degraded': return '#ffc107';
      case 'offline': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const getStatusClass = (status: string): string => {
    switch (status) {
      case 'healthy': return 'status-healthy';
      case 'degraded': return 'status-degraded';
      case 'offline': return 'status-offline';
      default: return 'status-unknown';
    }
  };

  if (isLoading && !portfolio) {
    return (
      <div className="portfolio-loading">
        <div className="loading-spinner"></div>
        <p>Loading portfolio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="portfolio-error">
        <h3>Portfolio Error</h3>
        <p>{error}</p>
        <button onClick={refreshPortfolio} className="btn btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="portfolio-empty">
        <h3>No Portfolio Data</h3>
        <p>Unable to load portfolio information.</p>
        <button onClick={refreshPortfolio} className="btn btn-primary">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="portfolio-view">
      <div className="portfolio-header">
        <div className="portfolio-summary">
          <div className="total-gold">
            <span className="gold-amount">{portfolio.totalGrams.toFixed(2)}g</span>
            <span className="gold-label">Total Gold Holdings</span>
          </div>
          <div className="portfolio-actions">
            <button 
              onClick={refreshPortfolio} 
              className="btn btn-secondary"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="last-updated">
          Last updated: {lastRefresh.toLocaleString()}
        </div>
      </div>

      <div className="portfolio-content">
        <div className="venues-section">
          <h3>Holdings by Venue</h3>
          <div className="venues-grid">
            {portfolio.venues.map((venue: VenueHolding) => (
              <div key={venue.venueId} className="venue-card">
                <div className="venue-header">
                  <h4>{venue.venueName}</h4>
                  <span className={`venue-status ${getStatusClass(venue.status)}`}>
                    {venue.status}
                  </span>
                </div>
                
                <div className="venue-holdings">
                  {venue.holdings.map((holding, index) => (
                    <div key={index} className="holding-item">
                      <div className="holding-symbol">{holding.symbol}</div>
                      <div className="holding-amounts">
                        <div className="holding-balance">
                          {holding.balance.toFixed(4)} {holding.symbol}
                        </div>
                        <div className="holding-grams">
                          {holding.gramsEquivalent.toFixed(2)}g
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="venue-total">
                  Total: {venue.holdings.reduce((sum, h) => sum + h.gramsEquivalent, 0).toFixed(2)}g
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="portfolio-breakdown">
          <h3>Portfolio Breakdown</h3>
          <div className="breakdown-chart">
            {portfolio.venues.map((venue: VenueHolding) => {
              const venueTotal = venue.holdings.reduce((sum, h) => sum + h.gramsEquivalent, 0);
              const percentage = (venueTotal / portfolio.totalGrams) * 100;
              
              return (
                <div key={venue.venueId} className="breakdown-item">
                  <div className="breakdown-label">
                    <span className="venue-name">{venue.venueName}</span>
                    <span className="venue-percentage">{percentage.toFixed(1)}%</span>
                  </div>
                  <div className="breakdown-bar">
                    <div 
                      className="breakdown-fill"
                      style={{ 
                        width: `${percentage}%`,
                        backgroundColor: getStatusColor(venue.status)
                      }}
                    />
                  </div>
                  <div className="breakdown-amount">
                    {venueTotal.toFixed(2)}g
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};