/**
 * Property-based tests for Portfolio data models
 * Feature: gold-router-app, Property 6: Portfolio holdings are normalized to grams
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Portfolio, TokenHolding, VenueHolding } from './Portfolio';
import { normalizeToGrams, XAUT_TO_GRAMS_FACTOR } from '../utils/goldConversions';

describe('Portfolio Data Models - Property Tests', () => {
  /**
   * Feature: gold-router-app, Property 6: Portfolio holdings are normalized to grams
   * Validates: Requirements 2.1
   * 
   * For any gold holdings across all venues, they should be displayed in the 
   * portfolio view normalized to grams regardless of the original token denomination
   */
  it('Property 6: Portfolio holdings are normalized to grams', () => {
    // Generator for supported gold token symbols
    const goldTokenArb = fc.constantFrom('XAUt', 'KAU', 'xaut', 'kau');
    
    // Generator for positive token balances
    const balanceArb = fc.float({ min: Math.fround(0.000001), max: Math.fround(1000000), noNaN: true });
    
    // Generator for TokenHolding
    const tokenHoldingArb = fc.record({
      symbol: goldTokenArb,
      balance: balanceArb,
      gramsEquivalent: fc.constant(0), // Will be calculated
      lastUpdated: fc.date()
    }).map((holding): TokenHolding => ({
      ...holding,
      gramsEquivalent: normalizeToGrams(holding.symbol, holding.balance)
    }));
    
    // Generator for VenueHolding
    const venueHoldingArb = fc.record({
      venueId: fc.string({ minLength: 1, maxLength: 20 }),
      venueName: fc.string({ minLength: 1, maxLength: 50 }),
      holdings: fc.array(tokenHoldingArb, { minLength: 1, maxLength: 5 }),
      status: fc.constantFrom('healthy', 'degraded', 'offline')
    });
    
    // Generator for Portfolio
    const portfolioArb = fc.record({
      venues: fc.array(venueHoldingArb, { minLength: 1, maxLength: 3 }),
      lastUpdated: fc.date(),
      status: fc.constantFrom('healthy', 'degraded', 'offline')
    }).map((portfolio): Portfolio => {
      // Calculate total grams from all venues
      const totalGrams = portfolio.venues.reduce((total, venue) => {
        return total + venue.holdings.reduce((venueTotal, holding) => {
          return venueTotal + holding.gramsEquivalent;
        }, 0);
      }, 0);
      
      return {
        ...portfolio,
        totalGrams
      };
    });

    fc.assert(
      fc.property(portfolioArb, (portfolio) => {
        // Property: All holdings should be normalized to grams
        for (const venue of portfolio.venues) {
          for (const holding of venue.holdings) {
            // Verify that gramsEquivalent is correctly calculated based on symbol
            const expectedGrams = normalizeToGrams(holding.symbol, holding.balance);
            
            // Allow for small floating point precision differences
            const tolerance = 0.000001;
            expect(Math.abs(holding.gramsEquivalent - expectedGrams)).toBeLessThan(tolerance);
            
            // Verify that grams equivalent is always positive for positive balances
            if (holding.balance > 0) {
              expect(holding.gramsEquivalent).toBeGreaterThan(0);
            }
            
            // Verify specific conversion rules
            if (holding.symbol.toLowerCase() === 'xaut') {
              const expectedXautGrams = holding.balance * XAUT_TO_GRAMS_FACTOR;
              expect(Math.abs(holding.gramsEquivalent - expectedXautGrams)).toBeLessThan(tolerance);
            } else if (holding.symbol.toLowerCase() === 'kau') {
              // KAU should be 1:1 with grams
              expect(Math.abs(holding.gramsEquivalent - holding.balance)).toBeLessThan(tolerance);
            }
          }
        }
        
        // Verify that totalGrams is the sum of all gramsEquivalent values
        const calculatedTotal = portfolio.venues.reduce((total, venue) => {
          return total + venue.holdings.reduce((venueTotal, holding) => {
            return venueTotal + holding.gramsEquivalent;
          }, 0);
        }, 0);
        
        const tolerance = 0.000001;
        expect(Math.abs(portfolio.totalGrams - calculatedTotal)).toBeLessThan(tolerance);
      }),
      { numRuns: 100 }
    );
  });
});