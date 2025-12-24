/**
 * Data Classification System for sensitive information handling
 */

export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal', 
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted'
}

export interface ClassifiedData {
  data: any;
  classification: DataClassification;
  redactionPolicy: RedactionPolicy;
}

export interface RedactionPolicy {
  shouldRedact: boolean;
  redactionLevel: 'partial' | 'full';
  allowedFields?: string[];
  redactedValue?: string;
}

export interface DataClassificationRule {
  fieldPattern: RegExp;
  classification: DataClassification;
  redactionPolicy: RedactionPolicy;
}

export class DataClassifier {
  private static readonly DEFAULT_RULES: DataClassificationRule[] = [
    // Restricted data - full redaction
    {
      fieldPattern: /^(apiKey|secret|privateKey|password|credential|token)$/i,
      classification: DataClassification.RESTRICTED,
      redactionPolicy: {
        shouldRedact: true,
        redactionLevel: 'full',
        redactedValue: '[REDACTED]'
      }
    },
    // Confidential data - partial redaction
    {
      fieldPattern: /^(address|wallet|account|userId|email)$/i,
      classification: DataClassification.CONFIDENTIAL,
      redactionPolicy: {
        shouldRedact: true,
        redactionLevel: 'partial',
        redactedValue: '[CONFIDENTIAL]'
      }
    },
    // Internal data - context-dependent redaction
    {
      fieldPattern: /^(orderId|venueId|balance|quantity|price)$/i,
      classification: DataClassification.INTERNAL,
      redactionPolicy: {
        shouldRedact: false,
        redactionLevel: 'partial'
      }
    },
    // Public data - no redaction
    {
      fieldPattern: /^(symbol|timestamp|status|type|side)$/i,
      classification: DataClassification.PUBLIC,
      redactionPolicy: {
        shouldRedact: false,
        redactionLevel: 'partial'
      }
    }
  ];

  private rules: DataClassificationRule[];

  constructor(customRules?: DataClassificationRule[]) {
    this.rules = customRules || DataClassifier.DEFAULT_RULES;
  }

  /**
   * Classifies data based on field names and content
   */
  classifyData(data: Record<string, any>): Record<string, ClassifiedData> {
    const classified: Record<string, ClassifiedData> = {};

    for (const [key, value] of Object.entries(data)) {
      const classification = this.classifyField(key, value);
      classified[key] = {
        data: value,
        classification: classification.classification,
        redactionPolicy: classification.redactionPolicy
      };
    }

    return classified;
  }

  /**
   * Applies redaction policies consistently across all data
   */
  applyRedactionPolicies(
    data: Record<string, any>, 
    context: 'export' | 'logging' | 'display' = 'export'
  ): Record<string, any> {
    const classified = this.classifyData(data);
    const redacted: Record<string, any> = {};

    for (const [key, classifiedData] of Object.entries(classified)) {
      const { data: originalData, redactionPolicy } = classifiedData;
      
      if (this.shouldRedactForContext(redactionPolicy, context)) {
        redacted[key] = this.applyRedaction(originalData, redactionPolicy);
      } else {
        // Recursively apply redaction to nested objects (but not Date objects)
        if (typeof originalData === 'object' && originalData !== null && !Array.isArray(originalData) && !(originalData instanceof Date)) {
          redacted[key] = this.applyRedactionPolicies(originalData, context);
        } else if (Array.isArray(originalData)) {
          redacted[key] = originalData.map(item => 
            typeof item === 'object' && item !== null && !(item instanceof Date)
              ? this.applyRedactionPolicies(item, context)
              : item
          );
        } else {
          redacted[key] = originalData;
        }
      }
    }

    return redacted;
  }

  /**
   * Gets the classification level for a specific field
   */
  getFieldClassification(fieldName: string): DataClassification {
    const rule = this.findMatchingRule(fieldName);
    return rule?.classification || DataClassification.INTERNAL;
  }

  /**
   * Validates that redaction policies are applied consistently
   */
  validateConsistentRedaction(
    originalData: Record<string, any>,
    redactedData: Record<string, any>,
    context: 'export' | 'logging' | 'display' = 'export'
  ): boolean {
    const classified = this.classifyData(originalData);
    
    for (const [key, classifiedData] of Object.entries(classified)) {
      const { redactionPolicy } = classifiedData;
      
      if (this.shouldRedactForContext(redactionPolicy, context)) {
        // Check that sensitive data was actually redacted
        if (redactedData[key] === originalData[key] && 
            typeof originalData[key] === 'string' && 
            originalData[key].length > 0) {
          return false; // Sensitive data not redacted
        }
      }
    }
    
    return true;
  }

  private classifyField(fieldName: string, value: any): {
    classification: DataClassification;
    redactionPolicy: RedactionPolicy;
  } {
    const rule = this.findMatchingRule(fieldName);
    
    if (rule) {
      return {
        classification: rule.classification,
        redactionPolicy: rule.redactionPolicy
      };
    }

    // Default classification for unknown fields
    return {
      classification: DataClassification.INTERNAL,
      redactionPolicy: {
        shouldRedact: false,
        redactionLevel: 'partial'
      }
    };
  }

  private findMatchingRule(fieldName: string): DataClassificationRule | undefined {
    return this.rules.find(rule => rule.fieldPattern.test(fieldName));
  }

  private shouldRedactForContext(
    policy: RedactionPolicy, 
    context: 'export' | 'logging' | 'display'
  ): boolean {
    if (!policy.shouldRedact) return false;
    
    // Always redact for export and logging
    if (context === 'export' || context === 'logging') {
      return true;
    }
    
    // For display, only redact restricted data
    return policy.redactionLevel === 'full';
  }

  private applyRedaction(data: any, policy: RedactionPolicy): any {
    if (policy.redactionLevel === 'full') {
      return policy.redactedValue || '[REDACTED]';
    }
    
    if (policy.redactionLevel === 'partial' && typeof data === 'string') {
      // Always use the specified redacted value for partial redaction if provided
      if (policy.redactedValue) {
        return policy.redactedValue;
      }
      
      if (data.length <= 4) {
        return '[REDACTED]';
      }
      // Show first 2 and last 2 characters
      return data.substring(0, 2) + '***' + data.substring(data.length - 2);
    }
    
    return policy.redactedValue || '[REDACTED]';
  }
}