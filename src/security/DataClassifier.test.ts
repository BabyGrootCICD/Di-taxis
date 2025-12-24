/**
 * Property-based tests for Data Classification System
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DataClassifier, DataClassification, DataClassificationRule } from './DataClassifier';

describe('DataClassifier Property Tests', () => {
  /**
   * **Feature: gold-router-app, Property 31: Data classification is applied consistently**
   * **Validates: Requirements 7.2**
   */
  it('Property 31: Data classification is applied consistently', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary data objects with various field types
        fc.record({
          // Restricted fields (should always be redacted)
          apiKey: fc.string({ minLength: 10, maxLength: 50 }),
          secret: fc.string({ minLength: 10, maxLength: 50 }),
          privateKey: fc.string({ minLength: 20, maxLength: 100 }),
          
          // Confidential fields (should be partially redacted)
          address: fc.string({ minLength: 5, maxLength: 42 }),
          userId: fc.string({ minLength: 5, maxLength: 20 }),
          
          // Internal fields (context-dependent)
          orderId: fc.string({ minLength: 5, maxLength: 20 }),
          balance: fc.float({ min: 0, max: 1000000 }),
          
          // Public fields (should not be redacted)
          symbol: fc.constantFrom('XAU', 'KAU', 'BTC', 'ETH'),
          timestamp: fc.date(),
          status: fc.constantFrom('active', 'inactive', 'pending')
        }),
        fc.constantFrom('export', 'logging', 'display'),
        (data, context) => {
          const classifier = new DataClassifier();
          
          // Apply redaction policies
          const redactedData = classifier.applyRedactionPolicies(data, context);
          
          // Verify consistent classification and redaction
          const classified = classifier.classifyData(data);
          
          // Check that restricted data is always redacted in export/logging contexts
          if (context === 'export' || context === 'logging') {
            // Restricted fields should be redacted
            expect(redactedData.apiKey).toBe('[REDACTED]');
            expect(redactedData.secret).toBe('[REDACTED]');
            expect(redactedData.privateKey).toBe('[REDACTED]');
            
            // Confidential fields should be redacted
            expect(redactedData.address).toBe('[CONFIDENTIAL]');
            expect(redactedData.userId).toBe('[CONFIDENTIAL]');
          }
          
          // Public fields should never be redacted
          expect(redactedData.symbol).toBe(data.symbol);
          expect(redactedData.timestamp).toBe(data.timestamp);
          expect(redactedData.status).toBe(data.status);
          
          // Verify classification consistency
          expect(classified.apiKey.classification).toBe(DataClassification.RESTRICTED);
          expect(classified.secret.classification).toBe(DataClassification.RESTRICTED);
          expect(classified.privateKey.classification).toBe(DataClassification.RESTRICTED);
          expect(classified.address.classification).toBe(DataClassification.CONFIDENTIAL);
          expect(classified.userId.classification).toBe(DataClassification.CONFIDENTIAL);
          expect(classified.symbol.classification).toBe(DataClassification.PUBLIC);
          expect(classified.timestamp.classification).toBe(DataClassification.PUBLIC);
          expect(classified.status.classification).toBe(DataClassification.PUBLIC);
          
          // Verify redaction validation
          const isConsistent = classifier.validateConsistentRedaction(data, redactedData, context);
          expect(isConsistent).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should classify fields correctly based on field names', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (fieldName, value) => {
          const classifier = new DataClassifier();
          const classification = classifier.getFieldClassification(fieldName);
          
          // Verify classification is one of the valid types
          const validClassifications = Object.values(DataClassification);
          expect(validClassifications).toContain(classification);
          
          // Verify consistent classification for same field name
          const classification2 = classifier.getFieldClassification(fieldName);
          expect(classification).toBe(classification2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle nested objects consistently', () => {
    fc.assert(
      fc.property(
        fc.record({
          user: fc.record({
            apiKey: fc.string({ minLength: 10 }),
            name: fc.string({ minLength: 1 }),
            settings: fc.record({
              secret: fc.string({ minLength: 10 }),
              theme: fc.string({ minLength: 1 })
            })
          }),
          order: fc.record({
            orderId: fc.string({ minLength: 5 }),
            symbol: fc.string({ minLength: 2 })
          })
        }),
        (nestedData) => {
          const classifier = new DataClassifier();
          const redacted = classifier.applyRedactionPolicies(nestedData, 'export');
          
          // Verify nested sensitive data is redacted
          expect(redacted.user.apiKey).toBe('[REDACTED]');
          expect(redacted.user.settings.secret).toBe('[REDACTED]');
          
          // Verify non-sensitive nested data is preserved
          expect(redacted.user.name).toBe(nestedData.user.name);
          expect(redacted.user.settings.theme).toBe(nestedData.user.settings.theme);
          expect(redacted.order.orderId).toBe(nestedData.order.orderId);
          expect(redacted.order.symbol).toBe(nestedData.order.symbol);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle arrays of objects consistently', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            apiKey: fc.string({ minLength: 10 }),
            symbol: fc.string({ minLength: 2 }),
            balance: fc.float({ min: 0 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (arrayData) => {
          const classifier = new DataClassifier();
          const data = { venues: arrayData };
          const redacted = classifier.applyRedactionPolicies(data, 'export');
          
          // Verify all array items are processed consistently
          expect(Array.isArray(redacted.venues)).toBe(true);
          expect(redacted.venues).toHaveLength(arrayData.length);
          
          redacted.venues.forEach((item: any, index: number) => {
            expect(item.apiKey).toBe('[REDACTED]');
            expect(item.symbol).toBe(arrayData[index].symbol);
            expect(item.balance).toBe(arrayData[index].balance);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should apply custom rules consistently', () => {
    fc.assert(
      fc.property(
        fc.record({
          customSensitive: fc.string({ minLength: 5 }),
          customPublic: fc.string({ minLength: 1 }),
          regularField: fc.string({ minLength: 1 })
        }),
        (data) => {
          const customRules: DataClassificationRule[] = [
            {
              fieldPattern: /^customSensitive$/,
              classification: DataClassification.RESTRICTED,
              redactionPolicy: {
                shouldRedact: true,
                redactionLevel: 'full',
                redactedValue: '[CUSTOM_REDACTED]'
              }
            },
            {
              fieldPattern: /^customPublic$/,
              classification: DataClassification.PUBLIC,
              redactionPolicy: {
                shouldRedact: false,
                redactionLevel: 'partial'
              }
            }
          ];
          
          const classifier = new DataClassifier(customRules);
          const redacted = classifier.applyRedactionPolicies(data, 'export');
          
          // Verify custom rules are applied
          expect(redacted.customSensitive).toBe('[CUSTOM_REDACTED]');
          expect(redacted.customPublic).toBe(data.customPublic);
          
          // Verify classification
          expect(classifier.getFieldClassification('customSensitive')).toBe(DataClassification.RESTRICTED);
          expect(classifier.getFieldClassification('customPublic')).toBe(DataClassification.PUBLIC);
        }
      ),
      { numRuns: 100 }
    );
  });
});