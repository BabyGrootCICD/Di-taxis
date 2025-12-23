import { createHash, createHmac, randomBytes } from 'crypto';
import { AuditEvent } from '../models/AuditEvent';

/**
 * Audit Service provides tamper-evident logging capabilities
 * with cryptographic signatures and structured event recording
 */
export class AuditService {
  private auditLog: AuditEvent[] = [];
  private readonly signingKey: Buffer;

  constructor(signingKey?: Buffer) {
    // Use provided key or generate a new one for this session
    this.signingKey = signingKey || randomBytes(32);
  }

  /**
   * Logs a security event with tamper-evident signature
   */
  logSecurityEvent(
    eventType: string,
    details: Record<string, any>,
    userId?: string,
    venueId?: string
  ): string {
    const eventId = this.generateEventId();
    const timestamp = new Date();
    
    // Redact sensitive data first
    const redactedDetails = this.redactSensitiveData(details);
    
    // Create event data for signature generation (using redacted data)
    const eventDataForSigning = {
      eventId,
      timestamp,
      eventType,
      userId,
      venueId,
      details: redactedDetails
    };

    // Generate cryptographic signature using redacted data
    const signature = this.generateSignature(eventDataForSigning);

    // Create the audit event
    const auditEvent: AuditEvent = {
      eventId,
      timestamp,
      eventType,
      userId,
      venueId,
      details: redactedDetails,
      signature
    };

    // Append-only logging
    this.auditLog.push(auditEvent);
    
    return eventId;
  }

  /**
   * Logs trade execution details
   */
  logTradeExecution(
    orderDetails: Record<string, any>,
    executionResult: Record<string, any>,
    userId?: string,
    venueId?: string
  ): string {
    return this.logSecurityEvent(
      'TRADE_EXECUTION',
      {
        orderDetails: this.redactSensitiveData(orderDetails),
        executionResult: this.redactSensitiveData(executionResult)
      },
      userId,
      venueId
    );
  }

  /**
   * Exports audit log with sensitive data filtering
   */
  exportAuditLog(startDate?: Date, endDate?: Date): AuditEvent[] {
    let filteredLog = this.auditLog;

    // Filter by date range if provided
    if (startDate || endDate) {
      filteredLog = this.auditLog.filter(event => {
        const eventTime = event.timestamp;
        if (startDate && eventTime < startDate) return false;
        if (endDate && eventTime > endDate) return false;
        return true;
      });
    }

    // Return deep copy with additional redaction for export
    return filteredLog.map(event => ({
      ...event,
      details: this.redactSensitiveData(event.details)
    }));
  }

  /**
   * Verifies the integrity of audit log entries
   */
  verifyLogIntegrity(): boolean {
    return this.auditLog.every(event => {
      const eventDataForVerification = {
        eventId: event.eventId,
        timestamp: event.timestamp,
        eventType: event.eventType,
        userId: event.userId,
        venueId: event.venueId,
        details: event.details
      };
      
      const expectedSignature = this.generateSignature(eventDataForVerification);
      return event.signature === expectedSignature;
    });
  }

  /**
   * Gets all audit events (for testing purposes)
   */
  getAllEvents(): AuditEvent[] {
    return [...this.auditLog];
  }

  /**
   * Clears audit log (for testing purposes only)
   */
  clearLog(): void {
    this.auditLog = [];
  }

  /**
   * Gets the signing key (for testing purposes)
   */
  getSigningKey(): Buffer {
    return this.signingKey;
  }

  private generateEventId(): string {
    return randomBytes(16).toString('hex');
  }

  private generateSignature(eventData: Omit<AuditEvent, 'signature'>): string {
    // Create a deterministic string representation for signing
    const signingData = {
      eventId: eventData.eventId,
      timestamp: eventData.timestamp.toISOString(),
      eventType: eventData.eventType,
      userId: eventData.userId || null,
      venueId: eventData.venueId || null,
      details: JSON.stringify(eventData.details, Object.keys(eventData.details || {}).sort())
    };
    
    const dataString = JSON.stringify(signingData, Object.keys(signingData).sort());
    return createHmac('sha256', this.signingKey)
      .update(dataString)
      .digest('hex');
  }

  private redactSensitiveData(data: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      'apiKey',
      'secret',
      'password',
      'privateKey',
      'address',
      'credential',
      'token',
      'key'
    ];

    const redacted = { ...data };
    
    for (const [key, value] of Object.entries(redacted)) {
      const lowerKey = key.toLowerCase();
      
      // Check if key contains sensitive terms
      if (sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey))) {
        redacted[key] = '[REDACTED]';
      }
      // Recursively redact nested objects
      else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        redacted[key] = this.redactSensitiveData(value);
      }
      // Redact arrays of objects
      else if (Array.isArray(value)) {
        redacted[key] = value.map(item => 
          typeof item === 'object' && item !== null 
            ? this.redactSensitiveData(item)
            : item
        );
      }
    }

    return redacted;
  }
}