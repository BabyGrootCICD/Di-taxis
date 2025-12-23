/**
 * Audit event and logging models
 */

export interface AuditEvent {
  eventId: string;
  timestamp: Date;
  eventType: string;
  userId?: string;
  venueId?: string;
  details: Record<string, any>;
  signature: string;
}