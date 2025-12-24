/**
 * Portfolio Service for unified portfolio management
 * Provides gold token normalization and multi-venue aggregation
 */

import { Portfolio, VenueHolding, TokenHolding, PortfolioStatus, VenueStatus } from '../models/Portfolio';
import { IExchangeConnector, Balance } from '../connectors/ExchangeConnector';
import { IOnChainTracker, TokenBalance } from '../connectors/OnChainTracker';
import { ConnectorStatus } from '../models/ConnectorStatus';
import { normalizeToGrams, XAUT_TO_GRAMS_FACTOR } from '../utils/goldConversions';
import { ErrorHandler, ApplicationError, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';
import { GracefulDegradationManager, ServiceCapability } from '../utils/GracefulDegradationManager';
import { StateRecoveryManager } from '../utils/StateRecoveryManager';
import { AuditService } from './AuditService';

export interface VenueConnector {
  id: string;
  name: string;
  type: 'exchange' | 'onchain';
  connector: IExchangeConnector | IOnChainTracker;
}

export interface PortfolioRefreshOptions {
  forceRefresh?: boolean;
  timeout?: number;
}

/**
 * Portfolio Service class for unified portfolio management
 */
export class PortfolioService {
  private venues: Map<string, VenueConnector> = new Map();
  private cachedPortfolio: Portfolio | null = null;
  private lastRefresh: Date | null = null;
  private refreshInProgress: boolean = false;
  private errorHandler: ErrorHandler;
  private degradationManager: GracefulDegradationManager;
  private stateRecoveryManager: StateRecoveryManager;
  private auditService: AuditService;

  constructor(
    auditService: AuditService,
    errorHandler?: ErrorHandler,
    degradationManager?: GracefulDegradationManager,
    stateRecoveryManager?: StateRecoveryManager
  ) {
    this.auditService = auditService;
    this.errorHandler = errorHandler || new ErrorHandler();
    this.degradationManager = degradationManager || new GracefulDegradationManager(auditService);
    this.stateRecoveryManager = stateRecoveryManager || new StateRecoveryManager(auditService);
    
    this.initializeErrorHandling();
  }

  /**
   * Register a venue connector for portfolio aggregation
   */
  registerVenue(venue: VenueConnector): void {
    this.venues.set(venue.id, venue);
    // Clear cache when venues change
    this.cachedPortfolio = null;
  }

  /**
   * Unregister a venue connector
   */
  unregisterVenue(venueId: string): void {
    this.venues.delete(venueId);
    // Clear cache when venues change
    this.cachedPortfolio = null;
  }

  /**
   * Convert XAUt (troy ounces) to grams using the exact conversion factor
   */
  convertXAUtToGrams(xautAmount: number): number {
    return xautAmount * XAUT_TO_GRAMS_FACTOR;
  }

  /**
   * Convert KAU to grams (1:1 ratio)
   */
  convertKAUToGrams(kauAmount: number): number {
    return kauAmount;
  }

  /**
   * Get current portfolio with all holdings normalized to grams
   */
  async getPortfolio(options: PortfolioRefreshOptions = {}): Promise<Portfolio> {
    return this.degradationManager.executeWithDegradation(
      ServiceCapability.PORTFOLIO_VIEW,
      async () => {
        return this.errorHandler.handleError(
          async () => {
            // Return cached portfolio if available and not forcing refresh
            if (!options.forceRefresh && this.cachedPortfolio && this.lastRefresh) {
              const cacheAge = Date.now() - this.lastRefresh.getTime();
              // Use cache if less than 30 seconds old
              if (cacheAge < 30000) {
                return this.cachedPortfolio;
              }
            }

            // Refresh portfolio data
            await this.refreshBalances(options);
            
            return this.cachedPortfolio || this.createEmptyPortfolio();
          },
          {
            operation: 'getPortfolio',
            component: 'PortfolioService',
            timestamp: new Date()
          }
        ).then(result => {
          if (!result.success) {
            throw result.error;
          }
          
          // Cache successful result for fallback
          if (result.result) {
            this.degradationManager.cacheFallbackData('portfolio', result.result, 'PortfolioService');
          }
          
          return result.result;
        });
      },
      {
        operation: 'getPortfolio',
        component: 'PortfolioService'
      }
    );
  }

  /**
   * Refresh balances from all connected venues
   */
  async refreshBalances(options: PortfolioRefreshOptions = {}): Promise<void> {
    if (this.refreshInProgress) {
      return; // Prevent concurrent refreshes
    }

    this.refreshInProgress = true;
    
    try {
      const venueHoldings: VenueHolding[] = [];
      let totalGrams = 0;
      let overallStatus: PortfolioStatus = 'healthy';

      // Process each venue
      for (const [venueId, venue] of this.venues) {
        try {
          const venueHolding = await this.getVenueHoldings(venue);
          venueHoldings.push(venueHolding);
          
          // Add to total grams
          totalGrams += venueHolding.holdings.reduce((sum, holding) => sum + holding.gramsEquivalent, 0);
          
          // Update overall status based on venue status
          if (venueHolding.status === 'offline') {
            overallStatus = 'degraded'; // Offline venues make portfolio degraded, not completely offline
          } else if (venueHolding.status === 'degraded' && overallStatus === 'healthy') {
            overallStatus = 'degraded';
          }
        } catch (error) {
          // Create offline venue holding for failed venues
          venueHoldings.push({
            venueId: venue.id,
            venueName: venue.name,
            holdings: [],
            status: 'offline'
          });
          overallStatus = 'degraded';
        }
      }

      // Update cached portfolio
      this.cachedPortfolio = {
        totalGrams,
        venues: venueHoldings,
        lastUpdated: new Date(),
        status: overallStatus
      };
      
      this.lastRefresh = new Date();
    } finally {
      this.refreshInProgress = false;
    }
  }

  /**
   * Get venue connectivity status indicators
   */
  async getVenueStatuses(): Promise<Map<string, VenueStatus>> {
    const statuses = new Map<string, VenueStatus>();
    
    for (const [venueId, venue] of this.venues) {
      try {
        const connectorStatus = venue.connector.getStatus();
        const venueStatus = this.mapConnectorStatusToVenueStatus(connectorStatus);
        statuses.set(venueId, venueStatus);
      } catch (error) {
        statuses.set(venueId, 'offline');
      }
    }
    
    return statuses;
  }

  /**
   * Get holdings for a specific venue
   */
  private async getVenueHoldings(venue: VenueConnector): Promise<VenueHolding> {
    const holdings: TokenHolding[] = [];
    let venueStatus: VenueStatus = 'healthy';

    try {
      const connectorStatus = venue.connector.getStatus();
      venueStatus = this.mapConnectorStatusToVenueStatus(connectorStatus);

      if (venue.type === 'exchange') {
        const exchangeConnector = venue.connector as IExchangeConnector;
        
        // Get balances for supported gold tokens
        const goldTokens = ['XAUt', 'KAU'];
        
        for (const symbol of goldTokens) {
          try {
            const balance = await exchangeConnector.getBalance(symbol);
            if (balance.total > 0) {
              holdings.push(this.createTokenHolding(symbol, balance.total));
            }
          } catch (error) {
            // Token might not be supported on this exchange, continue
          }
        }
      } else if (venue.type === 'onchain') {
        const onchainTracker = venue.connector as IOnChainTracker;
        
        // This would need to be configured with specific addresses and token contracts
        // For now, we'll leave this as a placeholder for future implementation
        // TODO: Implement on-chain balance retrieval with configured addresses
      }
    } catch (error) {
      venueStatus = 'offline';
    }

    return {
      venueId: venue.id,
      venueName: venue.name,
      holdings,
      status: venueStatus
    };
  }

  /**
   * Create a token holding with normalized grams equivalent
   */
  private createTokenHolding(symbol: string, balance: number): TokenHolding {
    return {
      symbol,
      balance,
      gramsEquivalent: normalizeToGrams(symbol, balance),
      lastUpdated: new Date()
    };
  }

  /**
   * Map connector status to venue status
   */
  private mapConnectorStatusToVenueStatus(connectorStatus: ConnectorStatus): VenueStatus {
    switch (connectorStatus.status) {
      case 'healthy':
        return 'healthy';
      case 'degraded':
        return 'degraded';
      case 'offline':
        return 'offline';
      default:
        return 'offline';
    }
  }

  /**
   * Create an empty portfolio
   */
  private createEmptyPortfolio(): Portfolio {
    return {
      totalGrams: 0,
      venues: [],
      lastUpdated: new Date(),
      status: 'healthy'
    };
  }

  /**
   * Get the last refresh timestamp
   */
  getLastRefresh(): Date | null {
    return this.lastRefresh;
  }

  /**
   * Check if a refresh is currently in progress
   */
  isRefreshInProgress(): boolean {
    return this.refreshInProgress;
  }

  /**
   * Initializes error handling strategies
   */
  private initializeErrorHandling(): void {
    // Register recovery strategies for portfolio operations
    this.errorHandler.registerRecoveryStrategy('getPortfolio', {
      strategy: 'retry' as any,
      maxAttempts: 2,
      backoffMs: 1000,
      degradedFunction: async () => {
        // Return cached portfolio data if available
        const cached = this.degradationManager.getFallbackData('portfolio');
        if (cached) {
          return {
            ...cached.data,
            status: 'degraded' as PortfolioStatus,
            lastUpdated: cached.timestamp,
            warning: 'Portfolio data may be outdated due to connectivity issues'
          };
        }
        return this.createEmptyPortfolio();
      }
    });

    this.errorHandler.registerRecoveryStrategy('refreshBalances', {
      strategy: 'retry' as any,
      maxAttempts: 3,
      backoffMs: 2000,
      fallbackFunction: async () => {
        // Try to get partial data from healthy venues only
        const partialPortfolio = await this.getPartialPortfolio();
        this.cachedPortfolio = partialPortfolio;
        this.lastRefresh = new Date();
      }
    });
  }

  /**
   * Gets partial portfolio from healthy venues only
   */
  private async getPartialPortfolio(): Promise<Portfolio> {
    const venueHoldings: VenueHolding[] = [];
    let totalGrams = 0;

    for (const [venueId, venue] of this.venues) {
      try {
        const connectorStatus = venue.connector.getStatus();
        if (connectorStatus.status === 'healthy') {
          const venueHolding = await this.getVenueHoldings(venue);
          venueHoldings.push(venueHolding);
          totalGrams += venueHolding.holdings.reduce((sum, holding) => sum + holding.gramsEquivalent, 0);
        }
      } catch (error) {
        // Skip unhealthy venues
        continue;
      }
    }

    return {
      totalGrams,
      venues: venueHoldings,
      lastUpdated: new Date(),
      status: 'degraded' as PortfolioStatus
    };
  }

  /**
   * Gets current state for recovery purposes
   */
  async getState(): Promise<Record<string, any>> {
    return {
      venues: Array.from(this.venues.entries()).map(([id, venue]) => ({
        id,
        name: venue.name,
        type: venue.type
      })),
      cachedPortfolio: this.cachedPortfolio,
      lastRefresh: this.lastRefresh?.toISOString(),
      refreshInProgress: this.refreshInProgress,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Restores state from recovery data
   */
  async setState(state: Record<string, any>): Promise<void> {
    if (state.cachedPortfolio) {
      this.cachedPortfolio = state.cachedPortfolio;
    }
    if (state.lastRefresh) {
      this.lastRefresh = new Date(state.lastRefresh);
    }
    if (typeof state.refreshInProgress === 'boolean') {
      this.refreshInProgress = state.refreshInProgress;
    }
  }

  /**
   * Creates a recovery point
   */
  async createRecoveryPoint(description: string): Promise<string> {
    const components = new Map([['PortfolioService', this]]);
    const snapshotId = await this.stateRecoveryManager.createStateSnapshot(components, {
      description,
      venueCount: this.venues.size,
      hasCachedPortfolio: !!this.cachedPortfolio
    });
    
    return this.stateRecoveryManager.createRecoveryPoint(snapshotId, description);
  }
}