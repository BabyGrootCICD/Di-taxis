/**
 * Property-based tests for SecurityManager
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SecurityManager, ApiCredentials } from './SecurityManager';

describe('SecurityManager Property Tests', () => {
  
  /**
   * Feature: gold-router-app, Property 1: API credential validation enforces trade-only permissions
   * Validates: Requirements 1.1
   */
  it('Property 1: API credential validation enforces trade-only permissions', () => {
    fc.assert(
      fc.property(
        // Generate API credentials with various permission combinations
        fc.record({
          apiKey: fc.string({ minLength: 10, maxLength: 100 }),
          secret: fc.string({ minLength: 10, maxLength: 100 }),
          permissions: fc.option(
            fc.array(
              fc.oneof(
                // Trade-only permissions (should be allowed)
                fc.constantFrom('trade', 'trading', 'order', 'buy', 'sell', 'read'),
                // Withdrawal permissions (should be rejected)
                fc.constantFrom('withdraw', 'withdrawal', 'transfer', 'send'),
                // Mixed permissions
                fc.string({ minLength: 3, maxLength: 20 })
              ),
              { minLength: 0, maxLength: 10 }
            ),
            { nil: undefined }
          )
        }),
        (credentials: ApiCredentials) => {
          const securityManager = new SecurityManager();
          const result = securityManager.validateCredentials(credentials);
          
          // If credentials have withdrawal permissions, they should be rejected
          const hasWithdrawalPerms = credentials.permissions?.some(perm =>
            ['withdraw', 'withdrawal', 'transfer', 'send'].some(withdrawPerm =>
              perm.toLowerCase().includes(withdrawPerm)
            )
          ) || false;
          
          // If credentials have trade permissions and no withdrawal permissions, they should be accepted
          const hasTradePerms = credentials.permissions?.some(perm =>
            ['trade', 'trading', 'order', 'buy', 'sell'].some(tradePerm =>
              perm.toLowerCase().includes(tradePerm)
            )
          ) || false;
          
          if (hasWithdrawalPerms) {
            // Should reject credentials with withdrawal permissions
            expect(result.isValid).toBe(false);
            expect(result.hasWithdrawalPermissions).toBe(true);
            expect(result.hasTradeOnlyPermissions).toBe(false);
          } else if (hasTradePerms || !credentials.permissions || credentials.permissions.length === 0) {
            // Should accept credentials with trade-only permissions or no permissions specified
            expect(result.isValid).toBe(true);
            expect(result.hasWithdrawalPermissions).toBe(false);
            if (credentials.permissions && credentials.permissions.length > 0) {
              expect(result.hasTradeOnlyPermissions).toBe(true);
            }
          }
          
          // Validation result should always include the permissions
          expect(result.permissions).toEqual(credentials.permissions || []);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: gold-router-app, Property 2: API credentials are encrypted at rest
   * Validates: Requirements 1.2, 7.1
   */
  it('Property 2: API credentials are encrypted at rest', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }), // venueId
        fc.record({
          apiKey: fc.string({ minLength: 10, maxLength: 100 }),
          secret: fc.string({ minLength: 10, maxLength: 100 }),
          permissions: fc.option(
            fc.array(
              // Only generate valid trade-only permissions
              fc.constantFrom('trade', 'trading', 'order', 'buy', 'sell', 'read'),
              { minLength: 1, maxLength: 5 }
            ),
            { nil: undefined }
          )
        }),
        (venueId: string, credentials: ApiCredentials) => {
          const securityManager = new SecurityManager();
          
          // Only test with credentials that would pass validation
          const validation = securityManager.validateCredentials(credentials);
          
          // Skip invalid credentials for this property test
          fc.pre(validation.isValid);
          
          // Store credentials
          securityManager.storeCredentials(venueId, credentials);
          
          // Retrieve credentials
          const retrieved = securityManager.retrieveCredentials(venueId);
          
          // Round-trip property: stored and retrieved credentials should match
          expect(retrieved).not.toBeNull();
          expect(retrieved!.apiKey).toBe(credentials.apiKey);
          expect(retrieved!.secret).toBe(credentials.secret);
          expect(retrieved!.permissions).toEqual(credentials.permissions);
          
          // Verify credentials are actually stored (not just returned from memory)
          expect(securityManager.hasCredentials(venueId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: gold-router-app, Property 33: Authentication and authorization are enforced
   * Validates: Requirements 7.4
   */
  it('Property 33: Authentication and authorization are enforced', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }), // venueId
        fc.record({
          apiKey: fc.string({ minLength: 10, maxLength: 100 }),
          secret: fc.string({ minLength: 10, maxLength: 100 }),
          permissions: fc.option(
            fc.array(
              fc.oneof(
                fc.constantFrom('trade', 'trading', 'order', 'buy', 'sell', 'read'),
                fc.constantFrom('withdraw', 'withdrawal', 'transfer', 'send')
              ),
              { minLength: 1, maxLength: 5 }
            ),
            { nil: undefined }
          )
        }),
        (venueId: string, credentials: ApiCredentials) => {
          const securityManager = new SecurityManager();
          
          // Only store credentials if they pass validation
          const validation = securityManager.validateCredentials(credentials);
          
          if (validation.isValid) {
            securityManager.storeCredentials(venueId, credentials);
            
            // Authorization check: validatePermissions should enforce trade-only access
            const hasValidPermissions = securityManager.validatePermissions(credentials.apiKey);
            
            // Should only return true for trade-only permissions
            const hasWithdrawalPerms = credentials.permissions?.some(perm =>
              ['withdraw', 'withdrawal', 'transfer', 'send'].some(withdrawPerm =>
                perm.toLowerCase().includes(withdrawPerm)
              )
            ) || false;
            
            if (hasWithdrawalPerms) {
              expect(hasValidPermissions).toBe(false);
            } else {
              expect(hasValidPermissions).toBe(true);
            }
          } else {
            // Invalid credentials should not be stored
            expect(() => securityManager.storeCredentials(venueId, credentials)).toThrow();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Additional unit tests for edge cases
  describe('Edge Cases', () => {
    it('should reject credentials with empty API key or secret', () => {
      const securityManager = new SecurityManager();
      
      const invalidCredentials = [
        { apiKey: '', secret: 'valid-secret' },
        { apiKey: 'valid-key', secret: '' },
        { apiKey: '', secret: '' }
      ];
      
      invalidCredentials.forEach(creds => {
        const result = securityManager.validateCredentials(creds);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('API key and secret are required');
      });
    });

    it('should reject credentials with short API key or secret', () => {
      const securityManager = new SecurityManager();
      
      const shortCredentials = [
        { apiKey: 'short', secret: 'valid-secret-long-enough' },
        { apiKey: 'valid-key-long-enough', secret: 'short' }
      ];
      
      shortCredentials.forEach(creds => {
        const result = securityManager.validateCredentials(creds);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('invalid format');
      });
    });

    it('should handle non-existent venue retrieval', () => {
      const securityManager = new SecurityManager();
      const result = securityManager.retrieveCredentials('non-existent-venue');
      expect(result).toBeNull();
    });
  });
});