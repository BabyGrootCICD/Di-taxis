/**
 * System State Recovery Manager
 * Handles state consistency and recovery after system failures
 */

import { AuditService } from '../services/AuditService';
import { ApplicationError, ErrorCategory, ErrorSeverity } from './ErrorHandler';

export interface SystemState {
  component: string;
  state: Record<string, any>;
  timestamp: Date;
  version: number;
  checksum: string;
}

export interface StateSnapshot {
  id: string;
  timestamp: Date;
  states: SystemState[];
  metadata: Record<string, any>;
}

export interface RecoveryPoint {
  id: string;
  timestamp: Date;
  description: string;
  snapshot: StateSnapshot;
  isValid: boolean;
}

export interface StateValidationRule {
  component: string;
  validator: (state: Record<string, any>) => boolean;
  description: string;
}

export interface RecoveryResult {
  success: boolean;
  recoveredComponents: string[];
  failedComponents: string[];
  errors: ApplicationError[];
  finalState: SystemState[];
}

/**
 * Manages system state snapshots and recovery
 */
export class StateRecoveryManager {
  private stateSnapshots: Map<string, StateSnapshot> = new Map();
  private recoveryPoints: Map<string, RecoveryPoint> = new Map();
  private validationRules: Map<string, StateValidationRule[]> = new Map();
  private auditService: AuditService;
  private maxSnapshots: number = 10;
  private maxRecoveryPoints: number = 5;

  constructor(auditService: AuditService) {
    this.auditService = auditService;
    this.initializeDefaultValidationRules();
  }

  /**
   * Creates a state snapshot of all registered components
   */
  async createStateSnapshot(
    components: Map<string, any>,
    metadata: Record<string, any> = {}
  ): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    const timestamp = new Date();
    const states: SystemState[] = [];

    // Capture state from each component
    for (const [componentName, component] of components) {
      try {
        const state = await this.extractComponentState(componentName, component);
        states.push(state);
      } catch (error) {
        // Log error but continue with other components
        this.auditService.logSecurityEvent('STATE_CAPTURE_ERROR', {
          component: componentName,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: timestamp.toISOString()
        });
      }
    }

    const snapshot: StateSnapshot = {
      id: snapshotId,
      timestamp,
      states,
      metadata
    };

    // Store snapshot
    this.stateSnapshots.set(snapshotId, snapshot);

    // Clean up old snapshots
    this.cleanupOldSnapshots();

    // Log snapshot creation
    this.auditService.logSecurityEvent('STATE_SNAPSHOT_CREATED', {
      snapshotId,
      componentCount: states.length,
      timestamp: timestamp.toISOString()
    });

    return snapshotId;
  }

  /**
   * Creates a recovery point with validation
   */
  async createRecoveryPoint(
    snapshotId: string,
    description: string
  ): Promise<string> {
    const snapshot = this.stateSnapshots.get(snapshotId);
    if (!snapshot) {
      throw new ApplicationError(
        `Snapshot ${snapshotId} not found`,
        'SNAPSHOT_NOT_FOUND',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: 'createRecoveryPoint',
          component: 'StateRecoveryManager',
          timestamp: new Date()
        }
      );
    }

    const recoveryPointId = this.generateRecoveryPointId();
    const isValid = await this.validateSnapshot(snapshot);

    const recoveryPoint: RecoveryPoint = {
      id: recoveryPointId,
      timestamp: new Date(),
      description,
      snapshot,
      isValid
    };

    this.recoveryPoints.set(recoveryPointId, recoveryPoint);

    // Clean up old recovery points
    this.cleanupOldRecoveryPoints();

    // Log recovery point creation
    this.auditService.logSecurityEvent('RECOVERY_POINT_CREATED', {
      recoveryPointId,
      snapshotId,
      description,
      isValid,
      timestamp: new Date().toISOString()
    });

    return recoveryPointId;
  }

  /**
   * Recovers system state from a recovery point
   */
  async recoverFromPoint(
    recoveryPointId: string,
    components: Map<string, any>
  ): Promise<RecoveryResult> {
    const recoveryPoint = this.recoveryPoints.get(recoveryPointId);
    if (!recoveryPoint) {
      throw new ApplicationError(
        `Recovery point ${recoveryPointId} not found`,
        'RECOVERY_POINT_NOT_FOUND',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: 'recoverFromPoint',
          component: 'StateRecoveryManager',
          timestamp: new Date()
        }
      );
    }

    if (!recoveryPoint.isValid) {
      throw new ApplicationError(
        `Recovery point ${recoveryPointId} is invalid`,
        'INVALID_RECOVERY_POINT',
        ErrorCategory.SYSTEM,
        ErrorSeverity.HIGH,
        {
          operation: 'recoverFromPoint',
          component: 'StateRecoveryManager',
          timestamp: new Date()
        }
      );
    }

    const recoveredComponents: string[] = [];
    const failedComponents: string[] = [];
    const errors: ApplicationError[] = [];
    const finalState: SystemState[] = [];

    // Log recovery start
    this.auditService.logSecurityEvent('STATE_RECOVERY_STARTED', {
      recoveryPointId,
      componentCount: recoveryPoint.snapshot.states.length,
      timestamp: new Date().toISOString()
    });

    // Recover each component
    for (const state of recoveryPoint.snapshot.states) {
      try {
        const component = components.get(state.component);
        if (!component) {
          failedComponents.push(state.component);
          errors.push(new ApplicationError(
            `Component ${state.component} not found for recovery`,
            'COMPONENT_NOT_FOUND',
            ErrorCategory.SYSTEM,
            ErrorSeverity.MEDIUM,
            {
              operation: 'recoverFromPoint',
              component: 'StateRecoveryManager',
              timestamp: new Date()
            }
          ));
          continue;
        }

        // Validate state before recovery
        const isStateValid = await this.validateComponentState(state.component, state.state);
        if (!isStateValid) {
          failedComponents.push(state.component);
          errors.push(new ApplicationError(
            `Invalid state for component ${state.component}`,
            'INVALID_STATE',
            ErrorCategory.SYSTEM,
            ErrorSeverity.MEDIUM,
            {
              operation: 'recoverFromPoint',
              component: 'StateRecoveryManager',
              timestamp: new Date()
            }
          ));
          continue;
        }

        // Restore component state
        await this.restoreComponentState(state.component, component, state.state);
        
        // Verify restoration
        const currentState = await this.extractComponentState(state.component, component);
        finalState.push(currentState);
        recoveredComponents.push(state.component);

      } catch (error) {
        failedComponents.push(state.component);
        errors.push(new ApplicationError(
          `Failed to recover component ${state.component}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'RECOVERY_FAILED',
          ErrorCategory.SYSTEM,
          ErrorSeverity.MEDIUM,
          {
            operation: 'recoverFromPoint',
            component: 'StateRecoveryManager',
            timestamp: new Date()
          },
          { originalError: error instanceof Error ? error : undefined }
        ));
      }
    }

    const result: RecoveryResult = {
      success: failedComponents.length === 0,
      recoveredComponents,
      failedComponents,
      errors,
      finalState
    };

    // Log recovery completion
    this.auditService.logSecurityEvent('STATE_RECOVERY_COMPLETED', {
      recoveryPointId,
      success: result.success,
      recoveredCount: recoveredComponents.length,
      failedCount: failedComponents.length,
      timestamp: new Date().toISOString()
    });

    return result;
  }

  /**
   * Validates system state consistency
   */
  async validateSystemState(components: Map<string, any>): Promise<{
    isValid: boolean;
    validComponents: string[];
    invalidComponents: string[];
    errors: ApplicationError[];
  }> {
    const validComponents: string[] = [];
    const invalidComponents: string[] = [];
    const errors: ApplicationError[] = [];

    for (const [componentName, component] of components) {
      try {
        const state = await this.extractComponentState(componentName, component);
        const isValid = await this.validateComponentState(componentName, state.state);
        
        if (isValid) {
          validComponents.push(componentName);
        } else {
          invalidComponents.push(componentName);
          errors.push(new ApplicationError(
            `Component ${componentName} has invalid state`,
            'INVALID_COMPONENT_STATE',
            ErrorCategory.SYSTEM,
            ErrorSeverity.MEDIUM,
            {
              operation: 'validateSystemState',
              component: 'StateRecoveryManager',
              timestamp: new Date()
            }
          ));
        }
      } catch (error) {
        invalidComponents.push(componentName);
        errors.push(new ApplicationError(
          `Failed to validate component ${componentName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'VALIDATION_ERROR',
          ErrorCategory.SYSTEM,
          ErrorSeverity.MEDIUM,
          {
            operation: 'validateSystemState',
            component: 'StateRecoveryManager',
            timestamp: new Date()
          },
          { originalError: error instanceof Error ? error : undefined }
        ));
      }
    }

    return {
      isValid: invalidComponents.length === 0,
      validComponents,
      invalidComponents,
      errors
    };
  }

  /**
   * Registers validation rules for a component
   */
  registerValidationRules(component: string, rules: StateValidationRule[]): void {
    this.validationRules.set(component, rules);
  }

  /**
   * Gets available recovery points
   */
  getRecoveryPoints(): RecoveryPoint[] {
    return Array.from(this.recoveryPoints.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Gets available snapshots
   */
  getSnapshots(): StateSnapshot[] {
    return Array.from(this.stateSnapshots.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Extracts state from a component
   */
  private async extractComponentState(componentName: string, component: any): Promise<SystemState> {
    let state: Record<string, any> = {};

    // Try different methods to extract state
    if (typeof component.getState === 'function') {
      state = await component.getState();
    } else if (typeof component.toJSON === 'function') {
      state = component.toJSON();
    } else if (typeof component.serialize === 'function') {
      state = await component.serialize();
    } else {
      // Extract public properties
      state = this.extractPublicProperties(component);
    }

    const timestamp = new Date();
    const version = 1; // Could be incremented for schema changes
    const checksum = this.calculateChecksum(state);

    return {
      component: componentName,
      state,
      timestamp,
      version,
      checksum
    };
  }

  /**
   * Restores state to a component
   */
  private async restoreComponentState(
    componentName: string,
    component: any,
    state: Record<string, any>
  ): Promise<void> {
    // Try different methods to restore state
    if (typeof component.setState === 'function') {
      await component.setState(state);
    } else if (typeof component.fromJSON === 'function') {
      await component.fromJSON(state);
    } else if (typeof component.deserialize === 'function') {
      await component.deserialize(state);
    } else if (typeof component.restore === 'function') {
      await component.restore(state);
    } else {
      // Restore public properties
      this.restorePublicProperties(component, state);
    }
  }

  /**
   * Validates a snapshot
   */
  private async validateSnapshot(snapshot: StateSnapshot): Promise<boolean> {
    try {
      // Check snapshot integrity
      if (!snapshot.id || !snapshot.timestamp || !snapshot.states) {
        return false;
      }

      // Validate each component state
      for (const state of snapshot.states) {
        // Verify checksum
        const currentChecksum = this.calculateChecksum(state.state);
        if (currentChecksum !== state.checksum) {
          return false;
        }

        // Validate against rules
        const isValid = await this.validateComponentState(state.component, state.state);
        if (!isValid) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validates component state against registered rules
   */
  private async validateComponentState(component: string, state: Record<string, any>): Promise<boolean> {
    const rules = this.validationRules.get(component) ?? [];
    
    for (const rule of rules) {
      try {
        if (!rule.validator(state)) {
          return false;
        }
      } catch (error) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extracts public properties from an object
   */
  private extractPublicProperties(obj: any): Record<string, any> {
    const state: Record<string, any> = {};
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !key.startsWith('_') && typeof obj[key] !== 'function') {
        const value = obj[key];
        
        // Handle different types
        if (value === null || value === undefined) {
          state[key] = value;
        } else if (typeof value === 'object') {
          if (value instanceof Date) {
            state[key] = value.toISOString();
          } else if (value instanceof Map) {
            state[key] = Object.fromEntries(value);
          } else if (value instanceof Set) {
            state[key] = Array.from(value);
          } else if (Array.isArray(value)) {
            state[key] = value;
          } else {
            state[key] = { ...value };
          }
        } else {
          state[key] = value;
        }
      }
    }
    
    return state;
  }

  /**
   * Restores public properties to an object
   */
  private restorePublicProperties(obj: any, state: Record<string, any>): void {
    for (const [key, value] of Object.entries(state)) {
      if (!key.startsWith('_')) {
        obj[key] = value;
      }
    }
  }

  /**
   * Calculates checksum for state integrity
   */
  private calculateChecksum(state: Record<string, any>): string {
    const crypto = require('crypto');
    const stateString = JSON.stringify(state, Object.keys(state).sort());
    return crypto.createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Generates unique snapshot ID
   */
  private generateSnapshotId(): string {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates unique recovery point ID
   */
  private generateRecoveryPointId(): string {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleans up old snapshots
   */
  private cleanupOldSnapshots(): void {
    const snapshots = Array.from(this.stateSnapshots.entries())
      .sort(([, a], [, b]) => b.timestamp.getTime() - a.timestamp.getTime());

    if (snapshots.length > this.maxSnapshots) {
      const toDelete = snapshots.slice(this.maxSnapshots);
      for (const [id] of toDelete) {
        this.stateSnapshots.delete(id);
      }
    }
  }

  /**
   * Cleans up old recovery points
   */
  private cleanupOldRecoveryPoints(): void {
    const points = Array.from(this.recoveryPoints.entries())
      .sort(([, a], [, b]) => b.timestamp.getTime() - a.timestamp.getTime());

    if (points.length > this.maxRecoveryPoints) {
      const toDelete = points.slice(this.maxRecoveryPoints);
      for (const [id] of toDelete) {
        this.recoveryPoints.delete(id);
      }
    }
  }

  /**
   * Initializes default validation rules
   */
  private initializeDefaultValidationRules(): void {
    // Trading Engine validation rules
    this.registerValidationRules('TradingEngine', [
      {
        component: 'TradingEngine',
        validator: (state) => {
          return state.orders && typeof state.orders === 'object';
        },
        description: 'Orders map must exist'
      },
      {
        component: 'TradingEngine',
        validator: (state) => {
          return state.config && typeof state.config === 'object';
        },
        description: 'Configuration must exist'
      }
    ]);

    // Portfolio Service validation rules
    this.registerValidationRules('PortfolioService', [
      {
        component: 'PortfolioService',
        validator: (state) => {
          return state.portfolioCache && typeof state.portfolioCache === 'object';
        },
        description: 'Portfolio cache must exist'
      }
    ]);

    // Security Manager validation rules
    this.registerValidationRules('SecurityManager', [
      {
        component: 'SecurityManager',
        validator: (state) => {
          return state.credentialStore && typeof state.credentialStore === 'object';
        },
        description: 'Credential store must exist'
      }
    ]);
  }
}