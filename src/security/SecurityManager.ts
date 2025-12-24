/**
 * Security Manager for credential handling and cryptographic operations
 */

import * as crypto from 'crypto';
import { DataClassifier } from './DataClassifier';
import { SecurityEventDetector, SecurityEventContext, SecurityEventType } from './SecurityEventDetector';
import { InputValidator } from './InputValidator';

export interface ApiCredentials {
  apiKey: string;
  secret: string;
  permissions?: string[];
}

export interface StoredCredentials {
  venueId: string;
  encryptedApiKey: string;
  encryptedSecret: string;
  iv: string;
  permissions?: string[];
  createdAt: Date;
  lastAccessed?: Date;
}

export interface CredentialValidationResult {
  isValid: boolean;
  hasTradeOnlyPermissions: boolean;
  hasWithdrawalPermissions: boolean;
  permissions: string[];
  errorMessage?: string;
}

export class SecurityManager {
  private readonly algorithm = 'aes-256-cbc';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly masterKey: Buffer;
  private readonly credentialStore: Map<string, StoredCredentials> = new Map();
  private readonly dataClassifier: DataClassifier;
  private readonly securityEventDetector: SecurityEventDetector;
  private readonly inputValidator: InputValidator;

  constructor(masterKey?: Buffer) {
    // In production, this should come from secure key management
    this.masterKey = masterKey || crypto.randomBytes(this.keyLength);
    this.dataClassifier = new DataClassifier();
    this.securityEventDetector = new SecurityEventDetector();
    this.inputValidator = new InputValidator();
  }

  /**
   * Validates API credentials to ensure they have trade-only permissions
   */
  validateCredentials(credentials: ApiCredentials): CredentialValidationResult {
    // Basic null/undefined check first
    if (!credentials.apiKey || !credentials.secret) {
      this.logSecurityEvent(SecurityEventType.INVALID_INPUT, {
        action: 'validateCredentials',
        validationFailed: true,
        reason: 'Missing credentials'
      });
      
      return {
        isValid: false,
        hasTradeOnlyPermissions: false,
        hasWithdrawalPermissions: false,
        permissions: [],
        errorMessage: 'API key and secret are required'
      };
    }

    // Trim whitespace and check for empty strings
    const trimmedApiKey = credentials.apiKey.trim();
    const trimmedSecret = credentials.secret.trim();
    
    if (trimmedApiKey.length === 0 || trimmedSecret.length === 0) {
      this.logSecurityEvent(SecurityEventType.INVALID_INPUT, {
        action: 'validateCredentials',
        validationFailed: true,
        reason: 'Empty credentials after trimming'
      });
      
      return {
        isValid: false,
        hasTradeOnlyPermissions: false,
        hasWithdrawalPermissions: false,
        permissions: [],
        errorMessage: 'API key and secret cannot be empty or whitespace only'
      };
    }

    // Use trimmed values for validation
    const trimmedCredentials = {
      ...credentials,
      apiKey: trimmedApiKey,
      secret: trimmedSecret
    };

    // Validate input format
    const inputValidation = this.inputValidator.validateApiCredentials(trimmedCredentials);
    if (!inputValidation.isValid) {
      this.logSecurityEvent(SecurityEventType.INVALID_INPUT, {
        action: 'validateCredentials',
        validationFailed: true,
        errors: inputValidation.errors
      });
      
      return {
        isValid: false,
        hasTradeOnlyPermissions: false,
        hasWithdrawalPermissions: false,
        permissions: [],
        errorMessage: inputValidation.errors.map(e => e.message).join(', ')
      };
    }

    // Check if credentials have proper format (basic validation)
    if (trimmedCredentials.apiKey.length < 10 || trimmedCredentials.secret.length < 10) {
      this.logSecurityEvent(SecurityEventType.INVALID_INPUT, {
        action: 'validateCredentials',
        validationFailed: true,
        reason: 'Invalid format'
      });
      
      return {
        isValid: false,
        hasTradeOnlyPermissions: false,
        hasWithdrawalPermissions: false,
        permissions: [],
        errorMessage: 'API credentials appear to be invalid format'
      };
    }

    const permissions = credentials.permissions || [];
    
    // Check for withdrawal permissions (these should NOT be present)
    const withdrawalPermissions = ['withdraw', 'withdrawal', 'transfer', 'send'];
    const hasWithdrawalPermissions = permissions.some(perm => 
      withdrawalPermissions.some(withdrawPerm => 
        perm.toLowerCase().includes(withdrawPerm)
      )
    );

    // Log security event if withdrawal permissions detected
    if (hasWithdrawalPermissions) {
      this.logSecurityEvent(SecurityEventType.CREDENTIAL_MISUSE, {
        action: 'validateCredentials',
        hasWithdrawalPermissions: true,
        permissions: this.dataClassifier.applyRedactionPolicies({ permissions }, 'logging').permissions
      });
    }

    // Check for trade permissions (these SHOULD be present)
    const tradePermissions = ['trade', 'trading', 'order', 'buy', 'sell'];
    const hasTradeOnlyPermissions = permissions.some(perm =>
      tradePermissions.some(tradePerm =>
        perm.toLowerCase().includes(tradePerm)
      )
    ) && !hasWithdrawalPermissions;

    // If no permissions specified, assume basic validation passed
    const isValid = permissions.length === 0 || hasTradeOnlyPermissions;

    return {
      isValid,
      hasTradeOnlyPermissions: permissions.length === 0 || hasTradeOnlyPermissions,
      hasWithdrawalPermissions,
      permissions,
      errorMessage: hasWithdrawalPermissions ? 'Credentials have withdrawal permissions - only trade-only permissions allowed' : undefined
    };
  }

  /**
   * Securely stores API credentials with encryption
   */
  storeCredentials(venueId: string, credentials: ApiCredentials): void {
    // Validate credentials first
    const validation = this.validateCredentials(credentials);
    if (!validation.isValid) {
      this.logSecurityEvent(SecurityEventType.AUTHORIZATION_VIOLATION, {
        action: 'storeCredentials',
        venueId,
        hasPermission: false,
        reason: validation.errorMessage
      });
      throw new Error(`Invalid credentials: ${validation.errorMessage}`);
    }

    // Generate unique IV for this encryption
    const iv = crypto.randomBytes(this.ivLength);
    
    // Encrypt API key
    const apiKeyCipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    const encryptedApiKey = Buffer.concat([
      apiKeyCipher.update(credentials.apiKey, 'utf8'),
      apiKeyCipher.final()
    ]).toString('base64');

    // Encrypt secret
    const secretCipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    const encryptedSecret = Buffer.concat([
      secretCipher.update(credentials.secret, 'utf8'),
      secretCipher.final()
    ]).toString('base64');

    // Store encrypted credentials
    const storedCredentials: StoredCredentials = {
      venueId,
      encryptedApiKey,
      encryptedSecret,
      iv: iv.toString('base64'),
      permissions: credentials.permissions,
      createdAt: new Date()
    };

    this.credentialStore.set(venueId, storedCredentials);
    
    // Log successful credential storage (without exposing secrets)
    this.logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILURE, {
      action: 'storeCredentials',
      venueId,
      success: true
    });
  }

  /**
   * Retrieves and decrypts stored credentials
   */
  retrieveCredentials(venueId: string): ApiCredentials | null {
    const stored = this.credentialStore.get(venueId);
    if (!stored) {
      this.logSecurityEvent(SecurityEventType.AUTHORIZATION_VIOLATION, {
        action: 'retrieveCredentials',
        venueId,
        hasPermission: false,
        reason: 'Credentials not found'
      });
      return null;
    }

    try {
      const iv = Buffer.from(stored.iv, 'base64');

      // Decrypt API key
      const apiKeyDecipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
      const apiKey = apiKeyDecipher.update(stored.encryptedApiKey, 'base64', 'utf8') + 
                     apiKeyDecipher.final('utf8');

      // Decrypt secret
      const secretDecipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
      const secret = secretDecipher.update(stored.encryptedSecret, 'base64', 'utf8') + 
                     secretDecipher.final('utf8');

      // Update last accessed time
      stored.lastAccessed = new Date();
      this.credentialStore.set(venueId, stored);

      return {
        apiKey,
        secret,
        permissions: stored.permissions
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logSecurityEvent(SecurityEventType.SYSTEM_ANOMALY, {
        action: 'retrieveCredentials',
        venueId,
        error: errorMessage
      });
      
      throw new Error(`Failed to decrypt credentials for venue ${venueId}: ${errorMessage}`);
    }
  }

  /**
   * Encrypts sensitive data using the master key
   */
  encryptSensitiveData(data: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);
    
    // Return IV + encrypted data, both base64 encoded
    return iv.toString('base64') + ':' + encrypted.toString('base64');
  }

  /**
   * Decrypts sensitive data
   */
  decryptSensitiveData(encryptedData: string): string {
    const [ivB64, dataB64] = encryptedData.split(':');
    
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv);
    
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  }

  /**
   * Validates API key permissions for trade-only access
   */
  validatePermissions(apiKey: string): boolean {
    // Find stored credentials by API key (in practice, this would be more secure)
    for (const [venueId, stored] of this.credentialStore.entries()) {
      try {
        const credentials = this.retrieveCredentials(venueId);
        if (credentials && credentials.apiKey === apiKey) {
          const validation = this.validateCredentials(credentials);
          return validation.hasTradeOnlyPermissions && !validation.hasWithdrawalPermissions;
        }
      } catch (error) {
        // Continue checking other credentials
      }
    }
    return false;
  }

  /**
   * Removes stored credentials for a venue
   */
  removeCredentials(venueId: string): boolean {
    const removed = this.credentialStore.delete(venueId);
    if (removed) {
      this.logSecurityEvent(SecurityEventType.AUTHENTICATION_FAILURE, {
        action: 'removeCredentials',
        venueId,
        success: true
      });
    }
    return removed;
  }

  /**
   * Lists all stored venue IDs (for management purposes)
   */
  getStoredVenues(): string[] {
    return Array.from(this.credentialStore.keys());
  }

  /**
   * Checks if credentials exist for a venue
   */
  hasCredentials(venueId: string): boolean {
    return this.credentialStore.has(venueId);
  }

  /**
   * Gets the data classifier instance
   */
  getDataClassifier(): DataClassifier {
    return this.dataClassifier;
  }

  /**
   * Gets the security event detector instance
   */
  getSecurityEventDetector(): SecurityEventDetector {
    return this.securityEventDetector;
  }

  /**
   * Gets the input validator instance
   */
  getInputValidator(): InputValidator {
    return this.inputValidator;
  }

  private logSecurityEvent(eventType: SecurityEventType, details: Record<string, any>): void {
    const context: SecurityEventContext = {
      action: details.action || 'unknown',
      resource: 'credentials',
      parameters: this.dataClassifier.applyRedactionPolicies(details, 'logging'),
      timestamp: new Date(),
      venueId: details.venueId
    };

    this.securityEventDetector.detectSecurityEvents(context);
  }
}