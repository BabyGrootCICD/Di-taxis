/**
 * Balance Discrepancy Detection Service
 * Detects and flags inconsistencies between venue balances and on-chain data
 */

import { Portfolio, VenueHolding, TokenHolding } from '../models/Portfolio';
import { IOnChainTracker, TokenBalance } from '../connectors/OnChainTracker';
import { AuditService } from './AuditService';
import { ErrorHandler, ApplicationError, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';

export interface DiscrepancyThreshold {
  absoluteThreshold: number; // Absolute difference in grams
  percentageThreshold: number; // Percentage difference (0-1)
}

export interface BalanceDiscrepancy {
  id: string;
  venueId: string;
  venueName: string;
  symbol: string;
  venueBalance: number;
  onChainBalance: number;
  venueGrams: number;
  onChainGrams: number;
  absoluteDifference: number;
  percentageDifference: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: Date;
  status: 'active' | 'investigating' | 'resolved' | 'false_positive';
  description: string;
}

export interface DiscrepancyResolution {
  discrepancyId: string;
  action: 'ignore' | 'investigate' | 'reconcile' | 'escalate';
  reason: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  notes?: string;
}

export interface DiscrepancyDetectionConfig {
  thresholds: {
    [symbol: string]: DiscrepancyThreshold;
  };
  defaultThreshold: DiscrepancyThreshold;
  enabledVenues: string[];
  checkIntervalMs: number;
  maxDiscrepancyAge: number; // Max age in milliseconds before auto-resolving
}

/**
 * Service for detecting balance discrepancies between venues and on-chain data
 */
export class BalanceDiscrepancyDetector {
  private config: DiscrepancyDetectionConfig;
  private auditService: AuditService;
  private errorHandler: ErrorHandler;
  private onChainTrackers: Map<string, IOnChainTracker> = new Map();
  private activeDiscrepancies: Map<string, BalanceDiscrepancy> = new Map();
  private resolutions: Map<string, DiscrepancyResolution> = new Map();
  private lastCheckTime: Date | null = null;
  private isRunning: boolean = false;

  constructor(
    config: DiscrepancyDetectionConfig,
    auditService: AuditService,
    errorHandler?: ErrorHandler
  ) {
    this.config = config;
    this.auditService = auditService;
    this.errorHandler = errorHandler || new ErrorHandler();
  }

  /**
   * Register an on-chain tracker for discrepancy detection
   */
  registerOnChainTracker(chainId: string, tracker: IOnChainTracker): void {
    this.onChainTrackers.set(chainId, tracker);
  }

  /**
   * Unregister an on-chain tracker
   */
  unregisterOnChainTracker(chainId: string): void {
    this.onChainTrackers.delete(chainId);
  }

  /**
   * Detect balance discrepancies for a given portfolio
   */
  async detectDiscrepancies(
    portfolio: Portfolio,
    addressMappings: Map<string, { address: string; chainId: string; tokenContract: string }>
  ): Promise<BalanceDiscrepancy[]> {
    const discrepancies: BalanceDiscrepancy[] = [];

    try {
      // Check each venue's holdings against on-chain data
      for (const venue of portfolio.venues) {
        if (!this.config.enabledVenues.includes(venue.venueId)) {
          continue; // Skip disabled venues
        }

        const venueDiscrepancies = await this.checkVenueDiscrepancies(venue, addressMappings);
        discrepancies.push(...venueDiscrepancies);
      }

      // Update active discrepancies
      this.updateActiveDiscrepancies(discrepancies);

      // Clean up old discrepancies
      this.cleanupOldDiscrepancies();

      // Log detection event
      await this.auditService.logSecurityEvent('balance_discrepancy_check', {
        portfolioStatus: portfolio.status,
        venuesChecked: portfolio.venues.length,
        discrepanciesFound: discrepancies.length,
        activeDiscrepancies: this.activeDiscrepancies.size
      });

      this.lastCheckTime = new Date();
      return discrepancies;

    } catch (error) {
      await this.auditService.logSecurityEvent('balance_discrepancy_check_failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        portfolioStatus: portfolio.status
      });
      throw error;
    }
  }

  /**
   * Check discrepancies for a specific venue
   */
  private async checkVenueDiscrepancies(
    venue: VenueHolding,
    addressMappings: Map<string, { address: string; chainId: string; tokenContract: string }>
  ): Promise<BalanceDiscrepancy[]> {
    const discrepancies: BalanceDiscrepancy[] = [];

    for (const holding of venue.holdings) {
      const mappingKey = `${venue.venueId}-${holding.symbol}`;
      const mapping = addressMappings.get(mappingKey);

      if (!mapping) {
        continue; // No on-chain mapping for this venue/token combination
      }

      try {
        const onChainBalance = await this.getOnChainBalance(
          mapping.address,
          mapping.tokenContract,
          mapping.chainId
        );

        const discrepancy = this.analyzeBalanceDiscrepancy(
          venue,
          holding,
          onChainBalance
        );

        if (discrepancy) {
          discrepancies.push(discrepancy);
        }

      } catch (error) {
        // Log error but continue checking other holdings
        await this.auditService.logSecurityEvent('on_chain_balance_check_failed', {
          venueId: venue.venueId,
          symbol: holding.symbol,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return discrepancies;
  }

  /**
   * Get on-chain balance for a specific address and token
   */
  private async getOnChainBalance(
    address: string,
    tokenContract: string,
    chainId: string
  ): Promise<TokenBalance> {
    const tracker = this.onChainTrackers.get(chainId);
    if (!tracker) {
      throw new Error(`No on-chain tracker registered for chain: ${chainId}`);
    }

    return await tracker.getBalance(address, tokenContract);
  }

  /**
   * Analyze balance discrepancy between venue and on-chain data
   */
  private analyzeBalanceDiscrepancy(
    venue: VenueHolding,
    venueHolding: TokenHolding,
    onChainBalance: TokenBalance
  ): BalanceDiscrepancy | null {
    const threshold = this.getThresholdForSymbol(venueHolding.symbol);
    
    // Convert on-chain balance to grams equivalent
    const onChainGrams = this.convertToGrams(onChainBalance.symbol, onChainBalance.balance);
    
    // Calculate differences
    const absoluteDifference = Math.abs(venueHolding.gramsEquivalent - onChainGrams);
    const percentageDifference = venueHolding.gramsEquivalent > 0 
      ? absoluteDifference / venueHolding.gramsEquivalent 
      : (onChainGrams > 0 ? 1 : 0);

    // Check if discrepancy exceeds thresholds
    const exceedsAbsolute = absoluteDifference > threshold.absoluteThreshold;
    const exceedsPercentage = percentageDifference > threshold.percentageThreshold;

    if (!exceedsAbsolute && !exceedsPercentage) {
      return null; // No significant discrepancy
    }

    // Determine severity
    const severity = this.calculateSeverity(absoluteDifference, percentageDifference, threshold);

    // Generate unique ID for this discrepancy
    const id = this.generateDiscrepancyId(venue.venueId, venueHolding.symbol);

    return {
      id,
      venueId: venue.venueId,
      venueName: venue.venueName,
      symbol: venueHolding.symbol,
      venueBalance: venueHolding.balance,
      onChainBalance: onChainBalance.balance,
      venueGrams: venueHolding.gramsEquivalent,
      onChainGrams,
      absoluteDifference,
      percentageDifference,
      severity,
      detectedAt: new Date(),
      status: 'active',
      description: this.generateDiscrepancyDescription(
        venue.venueName,
        venueHolding.symbol,
        absoluteDifference,
        percentageDifference
      )
    };
  }

  /**
   * Get threshold configuration for a specific symbol
   */
  private getThresholdForSymbol(symbol: string): DiscrepancyThreshold {
    return this.config.thresholds[symbol] || this.config.defaultThreshold;
  }

  /**
   * Convert token balance to grams equivalent
   */
  private convertToGrams(symbol: string, balance: number): number {
    switch (symbol.toUpperCase()) {
      case 'XAUT':
        return balance * 31.1034768; // Troy ounces to grams
      case 'KAU':
        return balance; // Already in grams
      default:
        return balance; // Assume 1:1 for unknown tokens
    }
  }

  /**
   * Calculate discrepancy severity
   */
  private calculateSeverity(
    absoluteDiff: number,
    percentageDiff: number,
    threshold: DiscrepancyThreshold
  ): 'low' | 'medium' | 'high' | 'critical' {
    const absMultiplier = absoluteDiff / threshold.absoluteThreshold;
    const pctMultiplier = percentageDiff / threshold.percentageThreshold;
    const maxMultiplier = Math.max(absMultiplier, pctMultiplier);

    if (maxMultiplier >= 10) return 'critical';
    if (maxMultiplier >= 5) return 'high';
    if (maxMultiplier >= 2) return 'medium';
    return 'low';
  }

  /**
   * Generate unique discrepancy ID
   */
  private generateDiscrepancyId(venueId: string, symbol: string): string {
    const timestamp = Date.now();
    return `${venueId}-${symbol}-${timestamp}`;
  }

  /**
   * Generate human-readable discrepancy description
   */
  private generateDiscrepancyDescription(
    venueName: string,
    symbol: string,
    absoluteDiff: number,
    percentageDiff: number
  ): string {
    const pctFormatted = (percentageDiff * 100).toFixed(2);
    return `Balance discrepancy detected for ${symbol} on ${venueName}: ${absoluteDiff.toFixed(4)} grams difference (${pctFormatted}%)`;
  }

  /**
   * Update active discrepancies map
   */
  private updateActiveDiscrepancies(newDiscrepancies: BalanceDiscrepancy[]): void {
    for (const discrepancy of newDiscrepancies) {
      // Check if this is an existing discrepancy
      const existingKey = `${discrepancy.venueId}-${discrepancy.symbol}`;
      const existing = Array.from(this.activeDiscrepancies.values())
        .find(d => `${d.venueId}-${d.symbol}` === existingKey && d.status === 'active');

      if (existing) {
        // Update existing discrepancy
        existing.onChainBalance = discrepancy.onChainBalance;
        existing.onChainGrams = discrepancy.onChainGrams;
        existing.absoluteDifference = discrepancy.absoluteDifference;
        existing.percentageDifference = discrepancy.percentageDifference;
        existing.severity = discrepancy.severity;
        existing.description = discrepancy.description;
      } else {
        // Add new discrepancy
        this.activeDiscrepancies.set(discrepancy.id, discrepancy);
      }
    }
  }

  /**
   * Clean up old discrepancies that have exceeded max age
   */
  private cleanupOldDiscrepancies(): void {
    const cutoffTime = Date.now() - this.config.maxDiscrepancyAge;
    
    for (const [id, discrepancy] of this.activeDiscrepancies) {
      if (discrepancy.detectedAt.getTime() < cutoffTime && discrepancy.status === 'active') {
        // Auto-resolve old discrepancies
        discrepancy.status = 'resolved';
        this.resolutions.set(id, {
          discrepancyId: id,
          action: 'ignore',
          reason: 'Auto-resolved due to age',
          resolvedAt: new Date()
        });
      }
    }
  }

  /**
   * Get all active discrepancies
   */
  getActiveDiscrepancies(): BalanceDiscrepancy[] {
    return Array.from(this.activeDiscrepancies.values())
      .filter(d => d.status === 'active');
  }

  /**
   * Get discrepancy by ID
   */
  getDiscrepancy(id: string): BalanceDiscrepancy | undefined {
    return this.activeDiscrepancies.get(id);
  }

  /**
   * Resolve a discrepancy
   */
  async resolveDiscrepancy(
    discrepancyId: string,
    resolution: Omit<DiscrepancyResolution, 'discrepancyId' | 'resolvedAt'>
  ): Promise<void> {
    const discrepancy = this.activeDiscrepancies.get(discrepancyId);
    if (!discrepancy) {
      throw new Error(`Discrepancy not found: ${discrepancyId}`);
    }

    // Update discrepancy status
    discrepancy.status = resolution.action === 'ignore' ? 'resolved' : 'investigating';

    // Store resolution
    const fullResolution: DiscrepancyResolution = {
      ...resolution,
      discrepancyId,
      resolvedAt: new Date()
    };
    this.resolutions.set(discrepancyId, fullResolution);

    // Log resolution
    await this.auditService.logSecurityEvent('balance_discrepancy_resolved', {
      discrepancyId,
      action: resolution.action,
      reason: resolution.reason,
      resolvedBy: resolution.resolvedBy
    });
  }

  /**
   * Get resolution for a discrepancy
   */
  getResolution(discrepancyId: string): DiscrepancyResolution | undefined {
    return this.resolutions.get(discrepancyId);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DiscrepancyDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DiscrepancyDetectionConfig {
    return { ...this.config };
  }

  /**
   * Get detection statistics
   */
  getStatistics(): {
    totalDiscrepancies: number;
    activeDiscrepancies: number;
    resolvedDiscrepancies: number;
    lastCheckTime: Date | null;
    averageSeverity: string;
  } {
    const active = this.getActiveDiscrepancies();
    const resolved = Array.from(this.activeDiscrepancies.values())
      .filter(d => d.status === 'resolved').length;

    // Calculate average severity
    const severityWeights = { low: 1, medium: 2, high: 3, critical: 4 };
    const totalWeight = active.reduce((sum, d) => sum + severityWeights[d.severity], 0);
    const avgWeight = active.length > 0 ? totalWeight / active.length : 0;
    
    let averageSeverity = 'none';
    if (avgWeight >= 3.5) averageSeverity = 'critical';
    else if (avgWeight >= 2.5) averageSeverity = 'high';
    else if (avgWeight >= 1.5) averageSeverity = 'medium';
    else if (avgWeight > 0) averageSeverity = 'low';

    return {
      totalDiscrepancies: this.activeDiscrepancies.size,
      activeDiscrepancies: active.length,
      resolvedDiscrepancies: resolved,
      lastCheckTime: this.lastCheckTime,
      averageSeverity
    };
  }

  /**
   * Start automatic discrepancy detection
   */
  startAutomaticDetection(
    portfolioProvider: () => Promise<Portfolio>,
    addressMappings: Map<string, { address: string; chainId: string; tokenContract: string }>
  ): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    
    const runDetection = async () => {
      if (!this.isRunning) return;

      try {
        const portfolio = await portfolioProvider();
        await this.detectDiscrepancies(portfolio, addressMappings);
      } catch (error) {
        // Log error but continue running
        await this.auditService.logSecurityEvent('automatic_discrepancy_detection_failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Schedule next run
      if (this.isRunning) {
        setTimeout(runDetection, this.config.checkIntervalMs);
      }
    };

    // Start first run
    setTimeout(runDetection, 1000);
  }

  /**
   * Stop automatic discrepancy detection
   */
  stopAutomaticDetection(): void {
    this.isRunning = false;
  }

  /**
   * Check if automatic detection is running
   */
  isAutomaticDetectionRunning(): boolean {
    return this.isRunning;
  }
}