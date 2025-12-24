import React, { useState, useEffect } from 'react';
import { AuditService } from '../../services/AuditService';
import { AuditEvent } from '../../models/AuditEvent';

interface AuditLogViewerProps {
  auditService: AuditService;
}

export const AuditLogViewer: React.FC<AuditLogViewerProps> = ({ auditService }) => {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    loadAuditLog();
  }, [auditService]);

  const loadAuditLog = async (startDate?: Date, endDate?: Date) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const events = await auditService.exportAuditLog(startDate, endDate);
      setAuditEvents(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDateRangeChange = (field: 'startDate' | 'endDate', value: string) => {
    setDateRange(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const applyDateFilter = () => {
    const startDate = dateRange.startDate ? new Date(dateRange.startDate) : undefined;
    const endDate = dateRange.endDate ? new Date(dateRange.endDate) : undefined;
    
    loadAuditLog(startDate, endDate);
  };

  const clearDateFilter = () => {
    setDateRange({ startDate: '', endDate: '' });
    loadAuditLog();
  };

  const exportAuditLog = async () => {
    try {
      const startDate = dateRange.startDate ? new Date(dateRange.startDate) : undefined;
      const endDate = dateRange.endDate ? new Date(dateRange.endDate) : undefined;
      
      const events = await auditService.exportAuditLog(startDate, endDate);
      
      // Create structured JSON export
      const exportData = {
        exportTimestamp: new Date().toISOString(),
        dateRange: {
          start: startDate?.toISOString() || null,
          end: endDate?.toISOString() || null
        },
        totalEvents: events.length,
        events: events
      };
      
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
      // Clean up
      URL.revokeObjectURL(link.href);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export audit log');
    }
  };

  const getEventTypeColor = (eventType: string): string => {
    switch (eventType) {
      case 'TRADE_EXECUTION': return '#007bff';
      case 'CREDENTIAL_STORAGE': return '#28a745';
      case 'HEALTH_CHECK': return '#17a2b8';
      case 'SECURITY_EVENT': return '#dc3545';
      case 'CONFIG_CHANGE': return '#ffc107';
      default: return '#6c757d';
    }
  };

  const formatEventDetails = (details: Record<string, any>): string => {
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  if (isLoading) {
    return (
      <div className="audit-loading">
        <div className="loading-spinner"></div>
        <p>Loading audit log...</p>
      </div>
    );
  }

  return (
    <div className="audit-log-viewer">
      <div className="audit-controls">
        <div className="card">
          <h2>Audit Log Controls</h2>
          
          {error && (
            <div className="message message-error">
              {error}
              <button onClick={() => setError(null)} className="message-close">×</button>
            </div>
          )}

          <div className="controls-row">
            <div className="date-filters">
              <div className="form-group">
                <label htmlFor="startDate">Start Date</label>
                <input
                  type="datetime-local"
                  id="startDate"
                  value={dateRange.startDate}
                  onChange={(e) => handleDateRangeChange('startDate', e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="endDate">End Date</label>
                <input
                  type="datetime-local"
                  id="endDate"
                  value={dateRange.endDate}
                  onChange={(e) => handleDateRangeChange('endDate', e.target.value)}
                />
              </div>
              
              <div className="filter-actions">
                <button onClick={applyDateFilter} className="btn btn-secondary">
                  Apply Filter
                </button>
                <button onClick={clearDateFilter} className="btn btn-outline">
                  Clear
                </button>
              </div>
            </div>

            <div className="export-actions">
              <button onClick={() => loadAuditLog()} className="btn btn-secondary">
                Refresh
              </button>
              <button onClick={exportAuditLog} className="btn btn-primary">
                Export Logs
              </button>
            </div>
          </div>

          <div className="audit-summary">
            <span className="event-count">
              {auditEvents.length} event{auditEvents.length !== 1 ? 's' : ''} found
            </span>
          </div>
        </div>
      </div>

      <div className="audit-log-content">
        <div className="card">
          <h2>Audit Events</h2>
          
          {auditEvents.length === 0 ? (
            <div className="empty-state">
              <p>No audit events found.</p>
              <p>Events will appear here as system activities are logged.</p>
            </div>
          ) : (
            <div className="audit-events">
              {auditEvents.map((event) => (
                <div key={event.eventId} className="audit-event">
                  <div className="event-header">
                    <div className="event-meta">
                      <span 
                        className="event-type"
                        style={{ backgroundColor: getEventTypeColor(event.eventType) }}
                      >
                        {event.eventType}
                      </span>
                      <span className="event-timestamp">
                        {event.timestamp.toLocaleString()}
                      </span>
                    </div>
                    <div className="event-id">
                      ID: {event.eventId}
                    </div>
                  </div>

                  <div className="event-body">
                    {event.userId && (
                      <div className="event-field">
                        <strong>User ID:</strong> {event.userId}
                      </div>
                    )}
                    
                    {event.venueId && (
                      <div className="event-field">
                        <strong>Venue ID:</strong> {event.venueId}
                      </div>
                    )}

                    <div className="event-field">
                      <strong>Details:</strong>
                      <pre className="event-details">
                        {formatEventDetails(event.details)}
                      </pre>
                    </div>

                    <div className="event-signature">
                      <strong>Signature:</strong>
                      <code>{event.signature.substring(0, 32)}...</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};