/**
 * Tests for comprehensive error handling and recovery system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  ErrorHandler, 
  ApplicationError, 
  ErrorCategory, 
  ErrorSeverity, 
  RecoveryStrategy,
  globalErrorHandler 
} from './ErrorHandler';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe('ApplicationError', () => {
    it('should create error with proper categorization', () => {
      const error = new ApplicationError(
        'Test error message',
        'TEST_ERROR',
        ErrorCategory.NETWORK,
        ErrorSeverity.HIGH,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(error.message).toBe('Test error message');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isRetryable).toBe(true); // Network errors are retryable
      expect(error.userMessage).toContain('Network connection issue');
      expect(error.suggestedActions).toContain('Check your internet connection');
    });

    it('should determine retryability correctly', () => {
      const networkError = new ApplicationError(
        'Network timeout',
        'NETWORK_TIMEOUT',
        ErrorCategory.NETWORK,
        ErrorSeverity.MEDIUM,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      const validationError = new ApplicationError(
        'Invalid input',
        'VALIDATION_ERROR',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(networkError.isRetryable).toBe(true);
      expect(validationError.isRetryable).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle successful operations', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await errorHandler.handleError(
        operation,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.recoveryAttempts).toBe(0);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValue('success');
      
      const result = await errorHandler.handleError(
        operation,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.recoveryAttempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should fail fast for non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('invalid input'));
      
      const result = await errorHandler.handleError(
        operation,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoveryAttempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use fallback function when available', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('network error'));
      const fallbackFunction = vi.fn().mockResolvedValue('fallback result');
      
      errorHandler.registerRecoveryStrategy('test', {
        strategy: RecoveryStrategy.FALLBACK,
        maxAttempts: 1,
        fallbackFunction
      });

      const result = await errorHandler.handleError(
        operation,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('fallback result');
      expect(result.strategyUsed).toBe(RecoveryStrategy.FALLBACK);
      expect(fallbackFunction).toHaveBeenCalled();
    });

    it('should use degraded function when fallback fails', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('network error'));
      const fallbackFunction = vi.fn().mockRejectedValue(new Error('fallback failed'));
      const degradedFunction = vi.fn().mockResolvedValue('degraded result');
      
      errorHandler.registerRecoveryStrategy('test', {
        strategy: RecoveryStrategy.DEGRADE,
        maxAttempts: 1,
        fallbackFunction,
        degradedFunction
      });

      const result = await errorHandler.handleError(
        operation,
        {
          operation: 'test',
          component: 'TestComponent',
          timestamp: new Date()
        }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('degraded result');
      expect(result.strategyUsed).toBe(RecoveryStrategy.DEGRADE);
      expect(degradedFunction).toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after repeated failures', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('persistent error'));
      
      // Trigger multiple failures to open circuit breaker
      for (let i = 0; i < 5; i++) {
        await errorHandler.handleError(operation, {
          operation: 'test_circuit',
          component: 'TestComponent',
          timestamp: new Date()
        });
      }

      // Next call should fail fast due to open circuit breaker
      const result = await errorHandler.handleError(operation, {
        operation: 'test_circuit',
        component: 'TestComponent',
        timestamp: new Date()
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CIRCUIT_BREAKER_OPEN');
      expect(result.strategyUsed).toBe(RecoveryStrategy.FAIL_FAST);
    });
  });

  describe('Error Metrics', () => {
    it('should track error metrics', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('test error'));
      
      await errorHandler.handleError(operation, {
        operation: 'test',
        component: 'TestComponent',
        timestamp: new Date()
      });

      const metrics = errorHandler.getErrorMetrics();
      expect(metrics.size).toBeGreaterThan(0);
      
      const errorKey = Array.from(metrics.keys())[0];
      const errorMetric = metrics.get(errorKey);
      expect(errorMetric?.count).toBe(1);
      expect(errorMetric?.lastOccurrence).toBeInstanceOf(Date);
    });
  });

  describe('Global Error Handler', () => {
    it('should provide global instance', () => {
      expect(globalErrorHandler).toBeInstanceOf(ErrorHandler);
    });
  });
});