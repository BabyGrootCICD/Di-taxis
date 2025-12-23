/**
 * Property-based tests for Portfolio Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { PortfolioService } from './PortfolioService';
import { XAUT_TO_GRAMS_FACTOR } from '../utils/goldConversions';

describe('Portfolio Service - Property Tests', () => {
  let portfolioService: PortfolioService;

  beforeEach(() => {
    portfolioService = new PortfolioService();
  });

  /**
   * Feature: gold-router-app, Property 7: XAUt conversion uses correct factor
   * Validates: Requirements 2.2
   * 
   * For any XAUt holdings, the conversion to grams should use the exact 
   * conversion factor of 31.1034768 grams per troy ounce
   */
  it('Property 7: XAUt conversion uses correct factor', () => {
    // Generator for positive XAUt amounts (troy ounces)
    const xautAmountArb = fc.float({ 
      min: Math.fround(0.000001), 
      max: Math.fround(1000000), 
      noNaN: true 
    });

    fc.assert(
      fc.property(xautAmountArb, (xautAmount) => {
        // Convert XAUt to grams using the service
        const convertedGrams = portfolioService.convertXAUtToGrams(xautAmount);
        
        // Expected conversion using the exact factor
        const expectedGrams = xautAmount * XAUT_TO_GRAMS_FACTOR;
        
        // Allow for small floating point precision differences
        const tolerance = 0.000001;
        expect(Math.abs(convertedGrams - expectedGrams)).toBeLessThan(tolerance);
        
        // Verify that positive amounts result in positive grams
        if (xautAmount > 0) {
          expect(convertedGrams).toBeGreaterThan(0);
        }
        
        // Verify that zero amount results in zero grams
        if (xautAmount === 0) {
          expect(convertedGrams).toBe(0);
        }
        
        // Verify the conversion factor is exactly as specified
        if (xautAmount > 0) {
          const actualFactor = convertedGrams / xautAmount;
          expect(Math.abs(actualFactor - XAUT_TO_GRAMS_FACTOR)).toBeLessThan(tolerance);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: gold-router-app, Property 8: KAU values display without conversion
   * Validates: Requirements 2.3
   * 
   * For any KAU holdings, the gram values should be displayed directly 
   * without any unit conversion
   */
  it('Property 8: KAU values display without conversion', () => {
    // Generator for positive KAU amounts (already in grams)
    const kauAmountArb = fc.float({ 
      min: Math.fround(0.000001), 
      max: Math.fround(1000000), 
      noNaN: true 
    });

    fc.assert(
      fc.property(kauAmountArb, (kauAmount) => {
        // Convert KAU to grams using the service
        const convertedGrams = portfolioService.convertKAUToGrams(kauAmount);
        
        // KAU should be 1:1 with grams (no conversion)
        expect(convertedGrams).toBe(kauAmount);
        
        // Verify that positive amounts result in positive grams
        if (kauAmount > 0) {
          expect(convertedGrams).toBeGreaterThan(0);
        }
        
        // Verify that zero amount results in zero grams
        if (kauAmount === 0) {
          expect(convertedGrams).toBe(0);
        }
        
        // Verify the conversion factor is exactly 1 (no conversion)
        if (kauAmount > 0) {
          const actualFactor = convertedGrams / kauAmount;
          expect(actualFactor).toBe(1);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: gold-router-app, Property 9: Portfolio updates trigger view refresh
   * Validates: Requirements 2.4
   * 
   * For any portfolio data update, the portfolio view should refresh to 
   * reflect the current balances immediately
   */
  it('Property 9: Portfolio updates trigger view refresh', async () => {
    // Create a mock exchange connector that returns different balances on subsequent calls
    const mockConnector = {
      getStatus: () => ({
        connectorId: 'test-exchange',
        connectorType: 'exchange' as const,
        name: 'Test Exchange',
        status: 'healthy' as const,
        lastHealthCheck: new Date(),
        latency: 100,
        errorRate: 0,
        capabilities: ['trading', 'balance']
      }),
      getBalance: vi.fn()
    };

    // Generator for different balance scenarios
    const balanceScenarioArb = fc.record({
      initialBalance: fc.float({ min: 0, max: 1000, noNaN: true }),
      updatedBalance: fc.float({ min: 0, max: 1000, noNaN: true }),
      symbol: fc.constantFrom('XAUt', 'KAU')
    });

    await fc.assert(
      fc.asyncProperty(balanceScenarioArb, async (scenario) => {
        // Create a fresh portfolio service for each test
        const testPortfolioService = new PortfolioService();
        
        // Reset the mock
        mockConnector.getBalance.mockReset();
        
        // Set up initial balance
        mockConnector.getBalance.mockResolvedValueOnce({
          symbol: scenario.symbol,
          available: scenario.initialBalance,
          total: scenario.initialBalance
        });

        // Register the mock venue
        const venue = {
          id: 'test-venue',
          name: 'Test Venue',
          type: 'exchange' as const,
          connector: mockConnector as any
        };
        
        testPortfolioService.registerVenue(venue);

        // Get initial portfolio
        const initialPortfolio = await testPortfolioService.getPortfolio({ forceRefresh: true });
        const initialLastUpdated = initialPortfolio.lastUpdated;

        // Wait a small amount to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10));

        // Set up updated balance
        mockConnector.getBalance.mockResolvedValueOnce({
          symbol: scenario.symbol,
          available: scenario.updatedBalance,
          total: scenario.updatedBalance
        });

        // Refresh portfolio
        await testPortfolioService.refreshBalances();
        const updatedPortfolio = await testPortfolioService.getPortfolio();

        // Verify that the portfolio was refreshed (lastUpdated should be newer)
        expect(updatedPortfolio.lastUpdated.getTime()).toBeGreaterThan(initialLastUpdated.getTime());

        // Verify that the balance reflects the updated value
        if (scenario.updatedBalance > 0) {
          const venueHolding = updatedPortfolio.venues.find(v => v.venueId === 'test-venue');
          expect(venueHolding).toBeDefined();
          
          const tokenHolding = venueHolding!.holdings.find(h => h.symbol === scenario.symbol);
          if (tokenHolding) {
            expect(tokenHolding.balance).toBe(scenario.updatedBalance);
          }
        }

        // Clean up
        testPortfolioService.unregisterVenue('test-venue');
      }),
      { numRuns: 50 } // Reduced runs for async tests
    );
  });
});  /**

   * Feature: gold-router-app, Property 10: Connectivity loss shows appropriate status
   * Validates: Requirements 2.5
   * 
   * For any venue that loses connectivity, the portfolio view should indicate 
   * unavailable balances with clear status indicators
   */
  it('Property 10: Connectivity loss shows appropriate status', async () => {
    // Generator for different connectivity scenarios
    const connectivityScenarioArb = fc.record({
      connectorStatus: fc.constantFrom('healthy', 'degraded', 'offline'),
      hasBalance: fc.boolean(),
      balance: fc.float({ min: 0, max: 1000, noNaN: true }),
      symbol: fc.constantFrom('XAUt', 'KAU')
    });

    await fc.assert(
      fc.asyncProperty(connectivityScenarioArb, async (scenario) => {
        // Create a fresh portfolio service for each test
        const testPortfolioService = new PortfolioService();
        
        // Create a mock connector with the specified status
        const mockConnector = {
          getStatus: () => ({
            connectorId: 'test-exchange',
            connectorType: 'exchange' as const,
            name: 'Test Exchange',
            status: scenario.connectorStatus as 'healthy' | 'degraded' | 'offline',
            lastHealthCheck: new Date(),
            latency: scenario.connectorStatus === 'offline' ? 5000 : 100,
            errorRate: scenario.connectorStatus === 'degraded' ? 0.2 : 0,
            capabilities: ['trading', 'balance']
          }),
          getBalance: vi.fn()
        };

        // Set up balance response based on scenario
        if (scenario.hasBalance && scenario.connectorStatus !== 'offline') {
          mockConnector.getBalance.mockResolvedValue({
            symbol: scenario.symbol,
            available: scenario.balance,
            total: scenario.balance
          });
        } else if (scenario.connectorStatus === 'offline') {
          // Offline connectors should throw errors
          mockConnector.getBalance.mockRejectedValue(new Error('Connection failed'));
        } else {
          mockConnector.getBalance.mockResolvedValue({
            symbol: scenario.symbol,
            available: 0,
            total: 0
          });
        }

        // Register the mock venue
        const venue = {
          id: 'test-venue',
          name: 'Test Venue',
          type: 'exchange' as const,
          connector: mockConnector as any
        };
        
        testPortfolioService.registerVenue(venue);

        // Get portfolio
        const portfolio = await testPortfolioService.getPortfolio({ forceRefresh: true });

        // Verify that venue status matches connector status
        const venueHolding = portfolio.venues.find(v => v.venueId === 'test-venue');
        expect(venueHolding).toBeDefined();

        // Map connector status to expected venue status
        let expectedVenueStatus: 'healthy' | 'degraded' | 'offline';
        switch (scenario.connectorStatus) {
          case 'healthy':
            expectedVenueStatus = 'healthy';
            break;
          case 'degraded':
            expectedVenueStatus = 'degraded';
            break;
          case 'offline':
            expectedVenueStatus = 'offline';
            break;
        }

        expect(venueHolding!.status).toBe(expectedVenueStatus);

        // Verify that offline venues have no holdings
        if (scenario.connectorStatus === 'offline') {
          expect(venueHolding!.holdings).toHaveLength(0);
        }

        // Verify that healthy/degraded venues with balance show holdings
        if (scenario.connectorStatus !== 'offline' && scenario.hasBalance && scenario.balance > 0) {
          const tokenHolding = venueHolding!.holdings.find(h => h.symbol === scenario.symbol);
          if (tokenHolding) {
            expect(tokenHolding.balance).toBe(scenario.balance);
          }
        }

        // Verify overall portfolio status reflects venue connectivity
        if (scenario.connectorStatus === 'offline') {
          expect(portfolio.status).toBe('degraded'); // At least one venue offline makes portfolio degraded
        }

        // Clean up
        testPortfolioService.unregisterVenue('test-venue');
      }),
      { numRuns: 50 } // Reduced runs for async tests
    );
  });