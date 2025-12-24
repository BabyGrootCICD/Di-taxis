import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuditService } from './AuditService';

describe('AuditService', () => {
  let auditService: AuditService;

  beforeEach(() => {
    auditService = new AuditService();
  });

  describe('Property-Based Tests', () => {
    /**
     * Feature: gold-router-app, Property 5: Credential storage events are audited without exposing secrets
     * Validates: Requirements 1.5
     */
    it('should audit credential storage events without exposing secrets', () => {
      fc.assert(
        fc.property(
          fc.record({
            apiKey: fc.string({ minLength: 10, maxLength: 50 }),
            secret: fc.string({ minLength: 20, maxLength: 100 }),
            venue: fc.string({ minLength: 3, maxLength: 20 }),
            permissions: fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
            otherData: fc.string()
          }),
          fc.option(fc.string({ minLength: 5, maxLength: 20 })),
          (credentialData, userId) => {
            // Clear log before test
            auditService.clearLog();

            // Log credential storage event
            const eventId = auditService.logSecurityEvent(
              'CREDENTIAL_STORAGE',
              credentialData,
              userId || undefined
            );

            // Verify event was logged
            const events = auditService.getAllEvents();
            expect(events).toHaveLength(1);

            const loggedEvent = events[0];
            expect(loggedEvent.eventId).toBe(eventId);
            expect(loggedEvent.eventType).toBe('CREDENTIAL_STORAGE');
            expect(loggedEvent.userId).toBe(userId || undefined);

            // Verify sensitive data is redacted
            expect(loggedEvent.details.apiKey).toBe('[REDACTED]');
            expect(loggedEvent.details.secret).toBe('[REDACTED]');
            
            // Verify non-sensitive data is preserved
            expect(loggedEvent.details.venue).toBe(credentialData.venue);
            expect(loggedEvent.details.permissions).toEqual(credentialData.permissions);
            expect(loggedEvent.details.otherData).toBe(credentialData.otherData);

            // Verify event has signature for tamper evidence
            expect(loggedEvent.signature).toBeDefined();
            expect(typeof loggedEvent.signature).toBe('string');
            expect(loggedEvent.signature.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: gold-router-app, Property 26: Audit exports include all security events
     * Validates: Requirements 6.1
     */
    it('should include all security events in audit exports', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              eventType: fc.constantFrom('CREDENTIAL_STORAGE', 'TRADE_EXECUTION', 'LOGIN', 'LOGOUT', 'CONFIG_CHANGE'),
              details: fc.record({
                action: fc.string(),
                data: fc.string()
              }),
              userId: fc.option(fc.string())
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (securityEvents) => {
            // Clear log before test
            auditService.clearLog();

            // Log all security events
            const eventIds: string[] = [];
            for (const event of securityEvents) {
              const eventId = auditService.logSecurityEvent(
                event.eventType,
                event.details,
                event.userId || undefined
              );
              eventIds.push(eventId);
            }

            // Export audit log
            const exportedEvents = auditService.exportAuditLog();

            // Verify all events are included in export
            expect(exportedEvents).toHaveLength(securityEvents.length);
            
            // Verify each logged event is in the export
            for (let i = 0; i < securityEvents.length; i++) {
              const originalEvent = securityEvents[i];
              const exportedEvent = exportedEvents[i];
              
              expect(exportedEvent.eventId).toBe(eventIds[i]);
              expect(exportedEvent.eventType).toBe(originalEvent.eventType);
              expect(exportedEvent.userId).toBe(originalEvent.userId || undefined);
              expect(exportedEvent.signature).toBeDefined();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: gold-router-app, Property 27: Sensitive data is redacted in exports
     * Validates: Requirements 6.2
     */
    it('should redact sensitive data in audit exports', () => {
      fc.assert(
        fc.property(
          fc.record({
            apiKey: fc.string({ minLength: 10, maxLength: 50 }),
            secret: fc.string({ minLength: 20, maxLength: 100 }),
            password: fc.string({ minLength: 8, maxLength: 30 }),
            privateKey: fc.string({ minLength: 32, maxLength: 64 }),
            address: fc.string({ minLength: 20, maxLength: 42 }),
            normalData: fc.string(),
            nestedSensitive: fc.record({
              credential: fc.string(),
              token: fc.string(),
              publicInfo: fc.string()
            })
          }),
          (sensitiveData) => {
            // Clear log before test
            auditService.clearLog();

            // Log event with sensitive data
            auditService.logSecurityEvent('TEST_EVENT', sensitiveData);

            // Export audit log
            const exportedEvents = auditService.exportAuditLog();
            expect(exportedEvents).toHaveLength(1);

            const exportedEvent = exportedEvents[0];
            const details = exportedEvent.details;

            // Verify sensitive fields are redacted
            expect(details.apiKey).toBe('[REDACTED]');
            expect(details.secret).toBe('[REDACTED]');
            expect(details.password).toBe('[REDACTED]');
            expect(details.privateKey).toBe('[REDACTED]');
            expect(details.address).toBe('[REDACTED]');

            // Verify nested sensitive data is redacted
            expect(details.nestedSensitive.credential).toBe('[REDACTED]');
            expect(details.nestedSensitive.token).toBe('[REDACTED]');

            // Verify non-sensitive data is preserved
            expect(details.normalData).toBe(sensitiveData.normalData);
            expect(details.nestedSensitive.publicInfo).toBe(sensitiveData.nestedSensitive.publicInfo);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: gold-router-app, Property 29: Audit exports use structured format
     * Validates: Requirements 6.4
     */
    it('should export audit logs in structured machine-readable format', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              eventType: fc.string({ minLength: 3, maxLength: 30 }),
              details: fc.record({
                action: fc.string({ minLength: 1, maxLength: 50 }),
                value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
                metadata: fc.option(fc.record({
                  source: fc.string(),
                  category: fc.string()
                }))
              }),
              userId: fc.option(fc.string({ minLength: 3, maxLength: 20 })),
              venueId: fc.option(fc.string({ minLength: 3, maxLength: 20 }))
            }),
            { minLength: 1, maxLength: 15 }
          ),
          (auditEvents) => {
            // Clear log before test
            auditService.clearLog();

            // Log all events
            for (const event of auditEvents) {
              auditService.logSecurityEvent(
                event.eventType,
                event.details,
                event.userId || undefined,
                event.venueId || undefined
              );
            }

            // Export audit log
            const exportedEvents = auditService.exportAuditLog();

            // Verify structured format compliance
            expect(Array.isArray(exportedEvents)).toBe(true);
            expect(exportedEvents).toHaveLength(auditEvents.length);

            // Verify each exported event has the required structured format
            exportedEvents.forEach((exportedEvent, index) => {
              // Required fields must be present and have correct types
              expect(exportedEvent).toHaveProperty('eventId');
              expect(typeof exportedEvent.eventId).toBe('string');
              expect(exportedEvent.eventId.length).toBeGreaterThan(0);

              expect(exportedEvent).toHaveProperty('timestamp');
              expect(exportedEvent.timestamp).toBeInstanceOf(Date);

              expect(exportedEvent).toHaveProperty('eventType');
              expect(typeof exportedEvent.eventType).toBe('string');
              expect(exportedEvent.eventType).toBe(auditEvents[index].eventType);

              expect(exportedEvent).toHaveProperty('details');
              expect(typeof exportedEvent.details).toBe('object');
              expect(exportedEvent.details).not.toBeNull();

              expect(exportedEvent).toHaveProperty('signature');
              expect(typeof exportedEvent.signature).toBe('string');
              expect(exportedEvent.signature.length).toBeGreaterThan(0);

              // Optional fields should have correct types when present
              if (exportedEvent.userId !== undefined) {
                expect(typeof exportedEvent.userId).toBe('string');
              }
              if (exportedEvent.venueId !== undefined) {
                expect(typeof exportedEvent.venueId).toBe('string');
              }

              // Verify the exported event can be serialized to JSON (machine-readable)
              expect(() => JSON.stringify(exportedEvent)).not.toThrow();
              
              // Verify the JSON can be parsed back (round-trip test for structured format)
              const jsonString = JSON.stringify(exportedEvent);
              const parsedEvent = JSON.parse(jsonString);
              
              expect(parsedEvent.eventId).toBe(exportedEvent.eventId);
              expect(parsedEvent.eventType).toBe(exportedEvent.eventType);
              expect(parsedEvent.signature).toBe(exportedEvent.signature);
              expect(parsedEvent.details).toEqual(exportedEvent.details);
            });

            // Verify the entire export can be serialized as structured data
            const fullExportJson = JSON.stringify(exportedEvents);
            expect(() => JSON.parse(fullExportJson)).not.toThrow();
            
            const parsedExport = JSON.parse(fullExportJson);
            expect(Array.isArray(parsedExport)).toBe(true);
            expect(parsedExport).toHaveLength(auditEvents.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: gold-router-app, Property 30: Audit logs include integrity protection
     * Validates: Requirements 6.5
     */
    it('should include integrity protection in audit logs', () => {
      fc.assert(
        fc.property(
          fc.record({
            eventType: fc.string({ minLength: 3, maxLength: 20 }),
            details: fc.record({
              action: fc.string(),
              value: fc.integer()
            }),
            userId: fc.option(fc.string())
          }),
          (eventData) => {
            // Clear log before test
            auditService.clearLog();

            // Log event
            const eventId = auditService.logSecurityEvent(
              eventData.eventType,
              eventData.details,
              eventData.userId || undefined
            );

            // Verify integrity protection
            const events = auditService.getAllEvents();
            expect(events).toHaveLength(1);

            const loggedEvent = events[0];
            
            // Verify signature exists and is valid
            expect(loggedEvent.signature).toBeDefined();
            expect(typeof loggedEvent.signature).toBe('string');
            expect(loggedEvent.signature.length).toBeGreaterThan(0);

            // Verify log integrity check passes initially
            expect(auditService.verifyLogIntegrity()).toBe(true);

            // Create a copy of the event with modified details to test tampering detection
            const originalDetails = JSON.parse(JSON.stringify(loggedEvent.details));
            loggedEvent.details.tamperedField = 'this should break integrity';
            
            // Verify tampering is detected
            expect(auditService.verifyLogIntegrity()).toBe(false);
            
            // Restore original details
            loggedEvent.details = originalDetails;
            expect(auditService.verifyLogIntegrity()).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    it('should create audit events with required metadata', () => {
      const eventId = auditService.logSecurityEvent(
        'TEST_EVENT',
        { action: 'test' },
        'user123',
        'venue456'
      );

      const events = auditService.getAllEvents();
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.eventId).toBe(eventId);
      expect(event.eventType).toBe('TEST_EVENT');
      expect(event.userId).toBe('user123');
      expect(event.venueId).toBe('venue456');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.signature).toBeDefined();
    });

    it('should export audit logs in structured format', () => {
      auditService.logSecurityEvent('EVENT1', { data: 'test1' });
      auditService.logSecurityEvent('EVENT2', { data: 'test2' });

      const exported = auditService.exportAuditLog();
      
      expect(Array.isArray(exported)).toBe(true);
      expect(exported).toHaveLength(2);
      
      // Verify structured format
      exported.forEach(event => {
        expect(event).toHaveProperty('eventId');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('eventType');
        expect(event).toHaveProperty('details');
        expect(event).toHaveProperty('signature');
      });
    });

    it('should filter audit logs by date range', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      auditService.logSecurityEvent('OLD_EVENT', { data: 'old' });
      
      const filtered = auditService.exportAuditLog(tomorrow, undefined);
      expect(filtered).toHaveLength(0);

      const allEvents = auditService.exportAuditLog(yesterday, tomorrow);
      expect(allEvents).toHaveLength(1);
    });

    it('should detect tampering in audit logs', () => {
      auditService.logSecurityEvent('TEST_EVENT', { data: 'original' });
      
      expect(auditService.verifyLogIntegrity()).toBe(true);
      
      const events = auditService.getAllEvents();
      const event = events[0];
      
      // Tamper with the event
      event.details.data = 'tampered';
      
      expect(auditService.verifyLogIntegrity()).toBe(false);
    });
  });
});