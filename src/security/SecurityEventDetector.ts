/**
 * Security Event Detection System
 */

export enum SecurityEventType {
  AUTHENTICATION_FAILURE = 'AUTHENTICATION_FAILURE',
  AUTHORIZATION_VIOLATION = 'AUTHORIZATION_VIOLATION',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  DATA_ACCESS_VIOLATION = 'DATA_ACCESS_VIOLATION',
  CREDENTIAL_MISUSE = 'CREDENTIAL_MISUSE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_INPUT = 'INVALID_INPUT',
  SYSTEM_ANOMALY = 'SYSTEM_ANOMALY'
}

export enum SecurityEventSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SecurityEvent {
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  timestamp: Date;
  source: string;
  details: Record<string, any>;
  userId?: string;
  venueId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SecurityEventRule {
  eventType: SecurityEventType;
  condition: (context: SecurityEventContext) => boolean;
  severity: SecurityEventSeverity;
  description: string;
}

export interface SecurityEventContext {
  userId?: string;
  venueId?: string;
  action: string;
  resource: string;
  parameters: Record<string, any>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  previousEvents?: SecurityEvent[];
}

export class SecurityEventDetector {
  private rules: SecurityEventRule[] = [];
  private eventHistory: SecurityEvent[] = [];
  private readonly maxHistorySize = 1000;

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Analyzes context and detects security events
   */
  detectSecurityEvents(context: SecurityEventContext): SecurityEvent[] {
    const detectedEvents: SecurityEvent[] = [];

    for (const rule of this.rules) {
      try {
        if (rule.condition(context)) {
          const event: SecurityEvent = {
            eventType: rule.eventType,
            severity: rule.severity,
            timestamp: context.timestamp,
            source: `${context.action}:${context.resource}`,
            details: {
              description: rule.description,
              action: context.action,
              resource: context.resource,
              parameters: this.sanitizeParameters(context.parameters)
            },
            userId: context.userId,
            venueId: context.venueId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent
          };

          detectedEvents.push(event);
          this.recordEvent(event);
        }
      } catch (error) {
        // Log rule evaluation error but continue processing
        console.error(`Error evaluating security rule for ${rule.eventType}:`, error);
      }
    }

    return detectedEvents;
  }

  /**
   * Adds a custom security event rule
   */
  addRule(rule: SecurityEventRule): void {
    this.rules.push(rule);
  }

  /**
   * Gets recent security events
   */
  getRecentEvents(limit: number = 100): SecurityEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Gets events by type
   */
  getEventsByType(eventType: SecurityEventType): SecurityEvent[] {
    return this.eventHistory.filter(event => event.eventType === eventType);
  }

  /**
   * Gets events by severity
   */
  getEventsBySeverity(severity: SecurityEventSeverity): SecurityEvent[] {
    return this.eventHistory.filter(event => event.severity === severity);
  }

  /**
   * Clears event history (for testing)
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  private initializeDefaultRules(): void {
    // Authentication failure detection
    this.rules.push({
      eventType: SecurityEventType.AUTHENTICATION_FAILURE,
      condition: (context) => {
        return context.action === 'authenticate' && 
               context.parameters.success === false;
      },
      severity: SecurityEventSeverity.MEDIUM,
      description: 'Authentication attempt failed'
    });

    // Multiple authentication failures
    this.rules.push({
      eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
      condition: (context) => {
        if (context.action !== 'authenticate' || !context.userId) return false;
        
        const recentFailures = this.eventHistory
          .filter(event => 
            event.eventType === SecurityEventType.AUTHENTICATION_FAILURE &&
            event.userId === context.userId &&
            event.timestamp > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
          );
        
        return recentFailures.length >= 2; // 2 or more failures triggers suspicious activity
      },
      severity: SecurityEventSeverity.HIGH,
      description: 'Multiple authentication failures detected'
    });

    // Credential access without proper permissions
    this.rules.push({
      eventType: SecurityEventType.AUTHORIZATION_VIOLATION,
      condition: (context) => {
        return context.action === 'retrieveCredentials' && 
               context.parameters.hasPermission === false;
      },
      severity: SecurityEventSeverity.HIGH,
      description: 'Attempted credential access without proper authorization'
    });

    // Invalid input detection
    this.rules.push({
      eventType: SecurityEventType.INVALID_INPUT,
      condition: (context) => {
        return context.parameters.validationFailed === true;
      },
      severity: SecurityEventSeverity.LOW,
      description: 'Invalid input detected'
    });

    // Credential misuse detection
    this.rules.push({
      eventType: SecurityEventType.CREDENTIAL_MISUSE,
      condition: (context) => {
        return context.action === 'validateCredentials' && 
               context.parameters.hasWithdrawalPermissions === true;
      },
      severity: SecurityEventSeverity.CRITICAL,
      description: 'Credentials with withdrawal permissions detected'
    });

    // Rate limiting
    this.rules.push({
      eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
      condition: (context) => {
        if (!context.userId) return false;
        
        const recentRequests = this.eventHistory
          .filter(event => 
            event.userId === context.userId &&
            event.timestamp > new Date(Date.now() - 60 * 1000) // Last minute
          );
        
        return recentRequests.length >= 100; // 100 or more requests per minute
      },
      severity: SecurityEventSeverity.MEDIUM,
      description: 'Rate limit exceeded'
    });

    // Data access violations
    this.rules.push({
      eventType: SecurityEventType.DATA_ACCESS_VIOLATION,
      condition: (context) => {
        return context.action === 'exportAuditLog' && 
               context.parameters.includesSensitiveData === true;
      },
      severity: SecurityEventSeverity.HIGH,
      description: 'Attempt to export sensitive data without proper redaction'
    });
  }

  private recordEvent(event: SecurityEvent): void {
    this.eventHistory.push(event);
    
    // Maintain history size limit
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  private sanitizeParameters(parameters: Record<string, any>): Record<string, any> {
    const sanitized = { ...parameters };
    const sensitiveKeys = ['password', 'secret', 'apiKey', 'privateKey', 'token', 'key', 'credential'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}