/**
 * Comprehensive Input Validation and Sanitization System
 */

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  allowedValues?: any[];
  customValidator?: (value: any) => boolean;
  sanitizer?: (value: any) => any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  sanitizedData: Record<string, any>;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export class InputValidator {
  private static readonly COMMON_PATTERNS = {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    API_KEY: /^[A-Za-z0-9_-]{10,}$/,
    VENUE_ID: /^[a-zA-Z0-9_-]{1,50}$/,
    ORDER_ID: /^[a-zA-Z0-9_-]{1,100}$/,
    SYMBOL: /^[A-Z]{2,10}$/,
    AMOUNT: /^\d+(\.\d{1,8})?$/,
    PRICE: /^\d+(\.\d{1,8})?$/
  };

  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi
  ];

  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /('|(\\')|(;)|(--)|(\|)|(\*)|(%)|(\+))/gi
  ];

  /**
   * Validates input data against provided rules
   */
  validate(data: Record<string, any>, rules: ValidationRule[]): ValidationResult {
    const errors: ValidationError[] = [];
    const sanitizedData: Record<string, any> = {};

    for (const rule of rules) {
      const value = data[rule.field];
      const fieldErrors = this.validateField(rule.field, value, rule);
      errors.push(...fieldErrors);

      // Apply sanitization if no validation errors
      if (fieldErrors.length === 0) {
        sanitizedData[rule.field] = this.sanitizeValue(value, rule);
      } else {
        sanitizedData[rule.field] = value; // Keep original for error reporting
      }
    }

    // Check for unexpected fields (potential injection attempt)
    const expectedFields = new Set(rules.map(rule => rule.field));
    for (const field of Object.keys(data)) {
      if (!expectedFields.has(field)) {
        errors.push({
          field,
          message: 'Unexpected field in input data',
          code: 'UNEXPECTED_FIELD'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedData
    };
  }

  /**
   * Sanitizes string input to prevent XSS and injection attacks
   */
  sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return String(input);
    }

    let sanitized = input;

    // Remove XSS patterns
    for (const pattern of InputValidator.XSS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove SQL injection patterns
    for (const pattern of InputValidator.SQL_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }

    // HTML encode special characters
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  /**
   * Validates API credentials format
   */
  validateApiCredentials(credentials: { apiKey: string; secret: string }): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'apiKey',
        required: true,
        type: 'string',
        minLength: 10,
        maxLength: 200,
        pattern: InputValidator.COMMON_PATTERNS.API_KEY
      },
      {
        field: 'secret',
        required: true,
        type: 'string',
        minLength: 10,
        maxLength: 200
      }
    ];

    return this.validate(credentials, rules);
  }

  /**
   * Validates order parameters
   */
  validateOrderParameters(order: Record<string, any>): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'symbol',
        required: true,
        type: 'string',
        pattern: InputValidator.COMMON_PATTERNS.SYMBOL
      },
      {
        field: 'side',
        required: true,
        type: 'string',
        allowedValues: ['buy', 'sell']
      },
      {
        field: 'quantity',
        required: true,
        type: 'number',
        min: 0.00000001,
        max: 1000000
      },
      {
        field: 'price',
        required: true,
        type: 'number',
        min: 0.00000001,
        max: 1000000
      },
      {
        field: 'slippageLimit',
        required: false,
        type: 'number',
        min: 0,
        max: 1
      },
      {
        field: 'venueId',
        required: true,
        type: 'string',
        pattern: InputValidator.COMMON_PATTERNS.VENUE_ID
      }
    ];

    return this.validate(order, rules);
  }

  /**
   * Validates portfolio query parameters
   */
  validatePortfolioQuery(query: Record<string, any>): ValidationResult {
    const rules: ValidationRule[] = [
      {
        field: 'venueId',
        required: false,
        type: 'string',
        pattern: InputValidator.COMMON_PATTERNS.VENUE_ID
      },
      {
        field: 'includeOffline',
        required: false,
        type: 'boolean'
      }
    ];

    return this.validate(query, rules);
  }

  private validateField(fieldName: string, value: any, rule: ValidationRule): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required fields
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: fieldName,
        message: `Field '${fieldName}' is required`,
        code: 'REQUIRED_FIELD'
      });
      return errors;
    }

    // Skip further validation if field is not required and empty
    if (!rule.required && (value === undefined || value === null || value === '')) {
      return errors;
    }

    // Type validation
    if (rule.type && !this.validateType(value, rule.type)) {
      errors.push({
        field: fieldName,
        message: `Field '${fieldName}' must be of type ${rule.type}`,
        code: 'INVALID_TYPE'
      });
      return errors;
    }

    // String validations
    if (rule.type === 'string' && typeof value === 'string') {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' must be at least ${rule.minLength} characters`,
          code: 'MIN_LENGTH'
        });
      }

      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' must be at most ${rule.maxLength} characters`,
          code: 'MAX_LENGTH'
        });
      }

      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' has invalid format`,
          code: 'INVALID_FORMAT'
        });
      }
    }

    // Number validations
    if (rule.type === 'number' && typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' must be at least ${rule.min}`,
          code: 'MIN_VALUE'
        });
      }

      if (rule.max !== undefined && value > rule.max) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' must be at most ${rule.max}`,
          code: 'MAX_VALUE'
        });
      }
    }

    // Allowed values validation
    if (rule.allowedValues && !rule.allowedValues.includes(value)) {
      errors.push({
        field: fieldName,
        message: `Field '${fieldName}' must be one of: ${rule.allowedValues.join(', ')}`,
        code: 'INVALID_VALUE'
      });
    }

    // Custom validation
    if (rule.customValidator && !rule.customValidator(value)) {
      errors.push({
        field: fieldName,
        message: `Field '${fieldName}' failed custom validation`,
        code: 'CUSTOM_VALIDATION'
      });
    }

    return errors;
  }

  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  private sanitizeValue(value: any, rule: ValidationRule): any {
    if (rule.sanitizer) {
      return rule.sanitizer(value);
    }

    if (rule.type === 'string' && typeof value === 'string') {
      return this.sanitizeString(value);
    }

    return value;
  }
}