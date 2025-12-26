/**
 * Discrepancy Notification Service
 * Handles user notifications for balance discrepancies
 */

import { BalanceDiscrepancy, DiscrepancyResolution } from './BalanceDiscrepancyDetector';
import { AuditService } from './AuditService';

export interface NotificationChannel {
  id: string;
  type: 'email' | 'webhook' | 'ui' | 'log';
  enabled: boolean;
  config: Record<string, any>;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  severityFilter: ('low' | 'medium' | 'high' | 'critical')[];
  venueFilter: string[]; // Empty array means all venues
  symbolFilter: string[]; // Empty array means all symbols
  channels: string[]; // Channel IDs to notify
  cooldownMs: number; // Minimum time between notifications for same discrepancy
}

export interface Notification {
  id: string;
  discrepancyId: string;
  ruleId: string;
  channelId: string;
  type: 'discrepancy_detected' | 'discrepancy_resolved' | 'discrepancy_escalated';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
  sentAt?: Date;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  retryCount: number;
  error?: string;
}

export interface NotificationConfig {
  maxRetries: number;
  retryDelayMs: number;
  maxPendingNotifications: number;
  cleanupIntervalMs: number;
  notificationTtlMs: number;
}

/**
 * Service for managing discrepancy notifications
 */
export class DiscrepancyNotificationService {
  private channels: Map<string, NotificationChannel> = new Map();
  private rules: Map<string, NotificationRule> = new Map();
  private notifications: Map<string, Notification> = new Map();
  private lastNotificationTime: Map<string, Date> = new Map(); // discrepancyId -> last notification time
  private auditService: AuditService;
  private config: NotificationConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    auditService: AuditService,
    config: NotificationConfig = {
      maxRetries: 3,
      retryDelayMs: 60000, // 1 minute
      maxPendingNotifications: 1000,
      cleanupIntervalMs: 300000, // 5 minutes
      notificationTtlMs: 86400000 // 24 hours
    }
  ) {
    this.auditService = auditService;
    this.config = config;
    this.startCleanupTimer();
  }

  /**
   * Register a notification channel
   */
  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.id, channel);
  }

  /**
   * Unregister a notification channel
   */
  unregisterChannel(channelId: string): void {
    this.channels.delete(channelId);
  }

  /**
   * Add a notification rule
   */
  addRule(rule: NotificationRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a notification rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /**
   * Update a notification rule
   */
  updateRule(ruleId: string, updates: Partial<NotificationRule>): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      this.rules.set(ruleId, { ...rule, ...updates });
    }
  }

  /**
   * Notify about a detected discrepancy
   */
  async notifyDiscrepancyDetected(discrepancy: BalanceDiscrepancy): Promise<void> {
    // Check cooldown
    if (this.isInCooldown(discrepancy.id)) {
      return;
    }

    // Find matching rules
    const matchingRules = this.findMatchingRules(discrepancy);

    // Create notifications for each matching rule
    for (const rule of matchingRules) {
      for (const channelId of rule.channels) {
        const channel = this.channels.get(channelId);
        if (channel && channel.enabled) {
          await this.createNotification(
            discrepancy,
            rule,
            channel,
            'discrepancy_detected'
          );
        }
      }
    }

    // Update last notification time
    this.lastNotificationTime.set(discrepancy.id, new Date());

    // Log notification event
    await this.auditService.logSecurityEvent('discrepancy_notification_sent', {
      discrepancyId: discrepancy.id,
      severity: discrepancy.severity,
      rulesMatched: matchingRules.length
    });
  }

  /**
   * Notify about a resolved discrepancy
   */
  async notifyDiscrepancyResolved(
    discrepancy: BalanceDiscrepancy,
    resolution: DiscrepancyResolution
  ): Promise<void> {
    // Find rules that were used for the original notification
    const matchingRules = this.findMatchingRules(discrepancy);

    // Create resolution notifications
    for (const rule of matchingRules) {
      for (const channelId of rule.channels) {
        const channel = this.channels.get(channelId);
        if (channel && channel.enabled) {
          await this.createResolutionNotification(
            discrepancy,
            resolution,
            rule,
            channel
          );
        }
      }
    }

    // Log resolution notification
    await this.auditService.logSecurityEvent('discrepancy_resolution_notification_sent', {
      discrepancyId: discrepancy.id,
      action: resolution.action,
      rulesMatched: matchingRules.length
    });
  }

  /**
   * Check if a discrepancy is in cooldown period
   */
  private isInCooldown(discrepancyId: string): boolean {
    const lastNotification = this.lastNotificationTime.get(discrepancyId);
    if (!lastNotification) {
      return false;
    }

    // Find the minimum cooldown from all applicable rules
    const minCooldown = Math.min(
      ...Array.from(this.rules.values())
        .filter(rule => rule.enabled)
        .map(rule => rule.cooldownMs)
    );

    const timeSinceLastNotification = Date.now() - lastNotification.getTime();
    return timeSinceLastNotification < minCooldown;
  }

  /**
   * Find notification rules that match a discrepancy
   */
  private findMatchingRules(discrepancy: BalanceDiscrepancy): NotificationRule[] {
    return Array.from(this.rules.values()).filter(rule => {
      if (!rule.enabled) return false;

      // Check severity filter
      if (rule.severityFilter.length > 0 && !rule.severityFilter.includes(discrepancy.severity)) {
        return false;
      }

      // Check venue filter
      if (rule.venueFilter.length > 0 && !rule.venueFilter.includes(discrepancy.venueId)) {
        return false;
      }

      // Check symbol filter
      if (rule.symbolFilter.length > 0 && !rule.symbolFilter.includes(discrepancy.symbol)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create a notification for a discrepancy
   */
  private async createNotification(
    discrepancy: BalanceDiscrepancy,
    rule: NotificationRule,
    channel: NotificationChannel,
    type: 'discrepancy_detected' | 'discrepancy_escalated'
  ): Promise<void> {
    const notification: Notification = {
      id: this.generateNotificationId(),
      discrepancyId: discrepancy.id,
      ruleId: rule.id,
      channelId: channel.id,
      type,
      title: this.generateNotificationTitle(discrepancy, type),
      message: this.generateNotificationMessage(discrepancy, type),
      severity: discrepancy.severity,
      createdAt: new Date(),
      status: 'pending',
      retryCount: 0
    };

    this.notifications.set(notification.id, notification);

    // Send notification immediately
    await this.sendNotification(notification);
  }

  /**
   * Create a resolution notification
   */
  private async createResolutionNotification(
    discrepancy: BalanceDiscrepancy,
    resolution: DiscrepancyResolution,
    rule: NotificationRule,
    channel: NotificationChannel
  ): Promise<void> {
    const notification: Notification = {
      id: this.generateNotificationId(),
      discrepancyId: discrepancy.id,
      ruleId: rule.id,
      channelId: channel.id,
      type: 'discrepancy_resolved',
      title: `Balance Discrepancy Resolved: ${discrepancy.symbol} on ${discrepancy.venueName}`,
      message: this.generateResolutionMessage(discrepancy, resolution),
      severity: discrepancy.severity,
      createdAt: new Date(),
      status: 'pending',
      retryCount: 0
    };

    this.notifications.set(notification.id, notification);

    // Send notification immediately
    await this.sendNotification(notification);
  }

  /**
   * Send a notification through its channel
   */
  private async sendNotification(notification: Notification): Promise<void> {
    const channel = this.channels.get(notification.channelId);
    if (!channel) {
      notification.status = 'failed';
      notification.error = 'Channel not found';
      return;
    }

    try {
      switch (channel.type) {
        case 'ui':
          await this.sendUINotification(notification, channel);
          break;
        case 'log':
          await this.sendLogNotification(notification, channel);
          break;
        case 'webhook':
          await this.sendWebhookNotification(notification, channel);
          break;
        case 'email':
          await this.sendEmailNotification(notification, channel);
          break;
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }

      notification.status = 'sent';
      notification.sentAt = new Date();

    } catch (error) {
      notification.status = 'failed';
      notification.error = error instanceof Error ? error.message : 'Unknown error';
      notification.retryCount++;

      // Schedule retry if under max retries
      if (notification.retryCount < this.config.maxRetries) {
        setTimeout(() => {
          this.sendNotification(notification);
        }, this.config.retryDelayMs * notification.retryCount);
      }
    }
  }

  /**
   * Send UI notification (store for UI to display)
   */
  private async sendUINotification(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<void> {
    // In a real implementation, this would push to a UI notification queue
    // For now, we'll just log it
    console.log(`UI Notification: ${notification.title} - ${notification.message}`);
  }

  /**
   * Send log notification
   */
  private async sendLogNotification(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<void> {
    const logLevel = this.mapSeverityToLogLevel(notification.severity);
    console[logLevel](`[${notification.severity.toUpperCase()}] ${notification.title}: ${notification.message}`);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<void> {
    // In a real implementation, this would make HTTP POST to webhook URL
    // For now, we'll simulate it
    const webhookUrl = channel.config.url;
    if (!webhookUrl) {
      throw new Error('Webhook URL not configured');
    }

    // Simulate webhook call
    console.log(`Webhook notification sent to ${webhookUrl}:`, {
      title: notification.title,
      message: notification.message,
      severity: notification.severity,
      discrepancyId: notification.discrepancyId
    });
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    notification: Notification,
    channel: NotificationChannel
  ): Promise<void> {
    // In a real implementation, this would send actual email
    // For now, we'll simulate it
    const recipient = channel.config.recipient;
    if (!recipient) {
      throw new Error('Email recipient not configured');
    }

    console.log(`Email notification sent to ${recipient}:`, {
      subject: notification.title,
      body: notification.message
    });
  }

  /**
   * Generate notification title
   */
  private generateNotificationTitle(
    discrepancy: BalanceDiscrepancy,
    type: 'discrepancy_detected' | 'discrepancy_escalated'
  ): string {
    const prefix = type === 'discrepancy_detected' ? 'Balance Discrepancy Detected' : 'Balance Discrepancy Escalated';
    return `${prefix}: ${discrepancy.symbol} on ${discrepancy.venueName}`;
  }

  /**
   * Generate notification message
   */
  private generateNotificationMessage(
    discrepancy: BalanceDiscrepancy,
    type: 'discrepancy_detected' | 'discrepancy_escalated'
  ): string {
    const baseMessage = discrepancy.description;
    const details = `Venue Balance: ${discrepancy.venueGrams.toFixed(4)} grams, On-Chain Balance: ${discrepancy.onChainGrams.toFixed(4)} grams`;
    
    if (type === 'discrepancy_escalated') {
      return `${baseMessage}\n${details}\nThis discrepancy has been escalated due to its severity or duration.`;
    }
    
    return `${baseMessage}\n${details}`;
  }

  /**
   * Generate resolution message
   */
  private generateResolutionMessage(
    discrepancy: BalanceDiscrepancy,
    resolution: DiscrepancyResolution
  ): string {
    const baseMessage = `The balance discrepancy for ${discrepancy.symbol} on ${discrepancy.venueName} has been resolved.`;
    const action = `Action taken: ${resolution.action}`;
    const reason = `Reason: ${resolution.reason}`;
    
    let message = `${baseMessage}\n${action}\n${reason}`;
    
    if (resolution.notes) {
      message += `\nNotes: ${resolution.notes}`;
    }
    
    return message;
  }

  /**
   * Generate unique notification ID
   */
  private generateNotificationId(): string {
    return `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Map severity to log level
   */
  private mapSeverityToLogLevel(severity: string): 'log' | 'warn' | 'error' {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warn';
      default:
        return 'log';
    }
  }

  /**
   * Get all notifications
   */
  getNotifications(filters?: {
    discrepancyId?: string;
    status?: 'pending' | 'sent' | 'failed' | 'cancelled';
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }): Notification[] {
    let notifications = Array.from(this.notifications.values());

    if (filters) {
      if (filters.discrepancyId) {
        notifications = notifications.filter(n => n.discrepancyId === filters.discrepancyId);
      }
      if (filters.status) {
        notifications = notifications.filter(n => n.status === filters.status);
      }
      if (filters.severity) {
        notifications = notifications.filter(n => n.severity === filters.severity);
      }
    }

    return notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get notification statistics
   */
  getStatistics(): {
    totalNotifications: number;
    pendingNotifications: number;
    sentNotifications: number;
    failedNotifications: number;
    notificationsByChannel: Record<string, number>;
    notificationsBySeverity: Record<string, number>;
  } {
    const notifications = Array.from(this.notifications.values());
    
    const byChannel: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    
    let pending = 0, sent = 0, failed = 0;
    
    for (const notification of notifications) {
      // Count by status
      switch (notification.status) {
        case 'pending': pending++; break;
        case 'sent': sent++; break;
        case 'failed': failed++; break;
      }
      
      // Count by channel
      byChannel[notification.channelId] = (byChannel[notification.channelId] || 0) + 1;
      
      // Count by severity
      bySeverity[notification.severity] = (bySeverity[notification.severity] || 0) + 1;
    }

    return {
      totalNotifications: notifications.length,
      pendingNotifications: pending,
      sentNotifications: sent,
      failedNotifications: failed,
      notificationsByChannel: byChannel,
      notificationsBySeverity: bySeverity
    };
  }

  /**
   * Start cleanup timer for old notifications
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldNotifications();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up old notifications
   */
  private cleanupOldNotifications(): void {
    const cutoffTime = Date.now() - this.config.notificationTtlMs;
    
    for (const [id, notification] of this.notifications) {
      if (notification.createdAt.getTime() < cutoffTime) {
        this.notifications.delete(id);
      }
    }
  }

  /**
   * Stop the service and cleanup resources
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}