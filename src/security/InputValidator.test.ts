/**
 * Tests for Input Validation and Sanitization System
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { InputValidator } from './InputValidator';

describe('InputValidator Tests', () => {
  it('should sanitize XSS attempts', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (input) => {
          const validator = new InputValidator();
          const sanitized = validator.sanitizeString(input);
          
          // Verify XSS patterns are removed/escaped
          expect(sanitized).not.toMatch(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi);
          expect(sanitized).not.toMatch(/javascript:/gi);
          expect(sanitized).not.toMatch(/on\w+\s*=/gi);
          
          // Verify HTML is escaped
          expect(sanitized).not.toContain('<');
          expect(sanitized).not.toContain('>');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate API credentials correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          apiKey: fc.string({ minLength: 10, maxLength: 200 }),
          secret: fc.string({ minLength: 10, maxLength: 200 })
        }),
        (credentials) => {
          const validator = new InputValidator();
          const result = validator.validateApiCredentials(credentials);
          
          if (result.isValid) {
            expect(result.errors).toHaveLength(0);
            expect(result.sanitizedData.apiKey).toBeDefined();
            expect(result.sanitizedData.secret).toBeDefined();
          } else {
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should validate order parameters correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          symbol: fc.constantFrom('XAU', 'KAU', 'BTC', 'ETH'),
          side: fc.constantFrom('buy', 'sell'),
          quantity: fc.float({ min: Math.fround(0.00000001), max: Math.fround(1000000) }),
          price: fc.float({ min: Math.fround(0.00000001), max: Math.fround(1000000) }),
          slippageLimit: fc.option(fc.float({ min: 0, max: 1 })),
          venueId: fc.string({ minLength: 1, maxLength: 50 })
        }),
        (orderParams) => {
          const validator = new InputValidator();
          const result = validator.validateOrderParameters(orderParams);
          
          if (result.isValid) {
            expect(result.errors).toHaveLength(0);
            expect(result.sanitizedData.symbol).toBe(orderParams.symbol);
            expect(result.sanitizedData.side).toBe(orderParams.side);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject invalid input formats', () => {
    const validator = new InputValidator();
    
    // Test invalid API credentials
    const invalidCreds = { apiKey: 'short', secret: 'short' };
    const credsResult = validator.validateApiCredentials(invalidCreds);
    expect(credsResult.isValid).toBe(false);
    expect(credsResult.errors.length).toBeGreaterThan(0);
    
    // Test invalid order parameters
    const invalidOrder = { 
      symbol: 'INVALID_SYMBOL_TOO_LONG', 
      side: 'invalid_side',
      quantity: -1,
      price: 0,
      venueId: 'test'
    };
    const orderResult = validator.validateOrderParameters(invalidOrder);
    expect(orderResult.isValid).toBe(false);
    expect(orderResult.errors.length).toBeGreaterThan(0);
  });
});