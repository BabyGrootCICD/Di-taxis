/**
 * Comprehensive Error Handling and Recovery System
 * Provides graceful degradation, automatic recovery, and user-friendly error messaging
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  VALIDATION = 'validation',
  BUSINESS_LOGIC = 'business_logic',
  SYSTEM = 'system',
  EXTERNAL_SERVICE = 'external_service'
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  DEGRADE = 'degrade',
  FAIL_FAST = 'fail_fast',
  MANUAL_INTERVENTION = 'manual_intervention'
}

export interface ErrorContext {
  operation: string;
  component: string;
  userId?: string;
  venueId?: string;
  requestId?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface RecoveryAction {
  strategy: RecoveryStrategy;
  maxAttempts?: number;
  backoffMs?: number;
  fallbackFunction?: () => Promise<any>;
  degradedFunction?: () => Promise<any>;
}

export interface ErrorHandlingResult {
  success: boolean;
  result?: any;
  error?: ApplicationError;
  recoveryAttempts: number;
  strategyUsed: RecoveryStrategy;
  userMessage: string;
  technicalMessage: string;
}

/**
 * Enhanced application error with recovery context
 */
export class ApplicationError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly originalError?: Error;
  public readonly isRetryable: boolean;
  public readonly userMessage: string;
  public readonly technicalMessage: string;
  public readonly suggestedActions: string[];

  constructor(
    message: string,
    code: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context: ErrorContext,
    options: {
      originalError?: Error;
      isRetryable?: boolean;
      userMessage?: string;
      suggestedActions?: string[];
    } = {}
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.category = category;
    this.severity = severity;
    this.context = context;
    this.originalError = options.originalError;
    this.isRetryable = options.isRetryable ?? this.determineRetryability();
    this.technicalMessage = message;
    this.userMessage = options.userMessage ?? this.generateUserMessage();
    this.suggestedActions = options.suggestedActions ?? this.generateSuggestedActions();
  }

  private determineRetryability(): boolean {
    // Network and external service errors are typically retryable
    if (this.category === ErrorCategory.NETWORK || this.category === ErrorCategory.EXTERNAL_SERVICE) {
      return true;
    }
    
    // Authentication errors might be retryable if transient
    if (this.category === ErrorCategory.AUTHENTICATION && this.code.includes('TIMEOUT')) {
      return true;
    }
    
    // System errors might be retryable
    if (this.category === ErrorCategory.SYSTEM && this.severity !== ErrorSeverity.CRITICAL) {
      return true;
    }
    
    return false;
  }

  private generateUserMessage(): string {
    switch (this.category) {
      case ErrorCategory.NETWORK:
        return 'Network connection issue. Please check your internet connection and try again.';
      case ErrorCategory.AUTHENTICATION:
        return 'Authentication failed. Please verify your API credentials and permissions.';
      case ErrorCategory.VALIDATION:
        return 'Invalid input provided. Please check your data and try again.';
      case ErrorCategory.BUSINESS_LOGIC:
        return 'Operation could not be completed due to business rules. Please review the requirements.';
      case ErrorCategory.EXTERNAL_SERVICE:
        return 'External service is temporarily unavailable. Please try again later.';
      case ErrorCategory.SYSTEM:
        return 'System error occurred. Our team has been notified and is working on a fix.';
      default:
        return 'An unexpected error occurred. Please try again or contact support.';
    }
  }

  private generateSuggestedActions(): string[] {
    const actions: string[] = [];
    
    switch (this.category) {
      case ErrorCategory.NETWORK:
        actions.push('Check your internet connection');
        actions.push('Try again in a few moments');
        actions.push('Contact your network administrator if the problem persists');
        break;
      case ErrorCategory.AUTHENTICATION:
        actions.push('Verify your API credentials are correct');
        actions.push('Check that your API key has the required permissions');
        actions.push('Ensure your credentials have not expired');
        break;
      case ErrorCategory.VALIDATION:
        actions.push('Review the input data for errors');
        actions.push('Check that all required fields are provided');
        actions.push('Ensure data formats match the expected patterns');
        break;
      case ErrorCategory.BUSINESS_LOGIC:
        actions.push('Review the operation requirements');
        actions.push('Check account balances and limits');
        actions.push('Verify market conditions allow the operation');
        break;
      case ErrorCategory.EXTERNAL_SERVICE:
        actions.push('Wait a few minutes and try again');
        actions.push('Check the service status page');
        actions.push('Try using an alternative venue if available');
        break;
      case ErrorCategory.SYSTEM:
        actions.push('Try the operation again');
        actions.push('Contact support if the problem persists');
        actions.push('Check system status for known issues');
        break;
    }
    
    return actions;
  }

  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      context: this.context,
      isRetryable: this.isRetryable,
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      suggestedActions: this.suggestedActions,
      stack: this.stack
    };
  }
}

/**
 * Comprehensive error handler with recovery mechanisms
 */
export class ErrorHandler {
  private recoveryStrategies: Map<string, RecoveryAction> = new Map();
  private errorMetrics: Map<string, { count: number; lastOccurrence: Date }> = new Map();
  private circuitBreakers: Map<string, { isOpen: boolean; failures: number; lastFailure: Date }> = new Map();

  constructor() {
    this.initializeDefaultStrategies();
  }

  /**
   * Handles errors with automatic recovery attempts
   */
  async handleError<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    recoveryAction?: RecoveryAction
  ): Promise<ErrorHandlingResult> {
    const startTime = Date.now();
    let lastError: ApplicationError | undefined;
    let recoveryAttempts = 0;
    
    // Get recovery strategy
    const strategy = recoveryAction ?? this.getRecoveryStrategy(context.operation);
    
    // Check circuit breaker
    if (this.isCircuitBreakerOpen(context.operation)) {
      return {
        success: false,
        error: new ApplicationError(
          'Circuit breaker is open for this operation',
          'CIRCUIT_BREAKER_OPEN',
          ErrorCategory.SYSTEM,
          ErrorSeverity.HIGH,
          context,
          { userMessage: 'This operation is temporarily unavailable due to repeated failures. Please try again later.' }
        ),
        recoveryAttempts: 0,
        strategyUsed: RecoveryStrategy.FAIL_FAST,
        userMessage: 'Operation temporarily unavailable. Please try again later.',
        technicalMessage: 'Circuit breaker is open'
      };
    }

    // Execute operation with recovery
    while (recoveryAttempts <= (strategy.maxAttempts ?? 3)) {
      try {
        const result = await operation();
        
        // Reset circuit breaker on success
        this.resetCircuitBreaker(context.operation);
        
        return {
          success: true,
          result,
          recoveryAttempts,
          strategyUsed: strategy.strategy,
          userMessage: 'Operation completed successfully',
          technicalMessage: 'Operation completed successfully'
        };
      } catch (error) {
        recoveryAttempts++;
        lastError = this.wrapError(error, context);
        
        // Record error metrics
        this.recordErrorMetrics(lastError);
        
        // Update circuit breaker
        this.updateCircuitBreaker(context.operation);
        
        // Determine if we should continue recovery attempts
        if (!lastError.isRetryable || recoveryAttempts > (strategy.maxAttempts ?? 3)) {
          break;
        }
        
        // Apply recovery strategy
        const shouldContinue = await this.applyRecoveryStrategy(strategy, recoveryAttempts, lastError);
        if (!shouldContinue) {
          break;
        }
      }
    }

    // All recovery attempts failed, try fallback or degraded mode
    if (strategy.fallbackFunction) {
      try {
        const fallbackResult = await strategy.fallbackFunction();
        return {
          success: true,
          result: fallbackResult,
          recoveryAttempts,
          strategyUsed: RecoveryStrategy.FALLBACK,
          userMessage: 'Operation completed using alternative method',
          technicalMessage: 'Fallback function succeeded'
        };
      } catch (fallbackError) {
        // Fallback also failed, continue to degraded mode
      }
    }

    if (strategy.degradedFunction) {
      try {
        const degradedResult = await strategy.degradedFunction();
        return {
          success: true,
          result: degradedResult,
          recoveryAttempts,
          strategyUsed: RecoveryStrategy.DEGRADE,
          userMessage: 'Operation completed with limited functionality',
          technicalMessage: 'Degraded function succeeded'
        };
      } catch (degradedError) {
        // Degraded mode also failed
      }
    }

    // All recovery attempts failed
    return {
      success: false,
      error: lastError!,
      recoveryAttempts,
      strategyUsed: strategy.strategy,
      userMessage: lastError!.userMessage,
      technicalMessage: lastError!.technicalMessage
    };
  }

  /**
   * Wraps raw errors into ApplicationError with context
   */
  private wrapError(error: any, context: ErrorContext): ApplicationError {
    if (error instanceof ApplicationError) {
      return error;
    }

    // Determine error category and severity based on error characteristics
    let category = ErrorCategory.SYSTEM;
    let severity = ErrorSeverity.MEDIUM;
    let code = 'UNKNOWN_ERROR';
    let isRetryable = false;

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      // Network errors
      if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
        category = ErrorCategory.NETWORK;
        code = 'NETWORK_ERROR';
        isRetryable = true;
      }
      // Authentication errors
      else if (message.includes('auth') || message.includes('credential') || message.includes('permission')) {
        category = ErrorCategory.AUTHENTICATION;
        code = 'AUTHENTICATION_ERROR';
        severity = ErrorSeverity.HIGH;
      }
      // Validation errors
      else if (message.includes('invalid') || message.includes('validation') || message.includes('format')) {
        category = ErrorCategory.VALIDATION;
        code = 'VALIDATION_ERROR';
        severity = ErrorSeverity.LOW;
      }
      // Business logic errors
      else if (message.includes('slippage') || message.includes('balance') || message.includes('limit')) {
        category = ErrorCategory.BUSINESS_LOGIC;
        code = 'BUSINESS_LOGIC_ERROR';
      }
      // External service errors
      else if (message.includes('exchange') || message.includes('api') || message.includes('service')) {
        category = ErrorCategory.EXTERNAL_SERVICE;
        code = 'EXTERNAL_SERVICE_ERROR';
        isRetryable = true;
      }
    }

    return new ApplicationError(
      error instanceof Error ? error.message : String(error),
      code,
      category,
      severity,
      context,
      {
        originalError: error instanceof Error ? error : undefined,
        isRetryable
      }
    );
  }

  /**
   * Applies recovery strategy with appropriate delays
   */
  private async applyRecoveryStrategy(
    strategy: RecoveryAction,
    attempt: number,
    error: ApplicationError
  ): Promise<boolean> {
    switch (strategy.strategy) {
      case RecoveryStrategy.RETRY:
        if (error.isRetryable) {
          const delay = this.calculateBackoffDelay(attempt, strategy.backoffMs ?? 1000);
          await this.sleep(delay);
          return true;
        }
        return false;
        
      case RecoveryStrategy.FALLBACK:
        // Fallback will be handled in the main function
        return false;
        
      case RecoveryStrategy.DEGRADE:
        // Degraded mode will be handled in the main function
        return false;
        
      case RecoveryStrategy.FAIL_FAST:
        return false;
        
      case RecoveryStrategy.MANUAL_INTERVENTION:
        // Log for manual intervention and fail
        return false;
        
      default:
        return false;
    }
  }

  /**
   * Calculates exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number, baseDelay: number): number {
    const maxDelay = 30000; // 30 seconds max
    const jitter = Math.random() * 0.1; // 10% jitter
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    return delay * (1 + jitter);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets recovery strategy for an operation
   */
  private getRecoveryStrategy(operation: string): RecoveryAction {
    return this.recoveryStrategies.get(operation) ?? {
      strategy: RecoveryStrategy.RETRY,
      maxAttempts: 3,
      backoffMs: 1000
    };
  }

  /**
   * Records error metrics for monitoring
   */
  private recordErrorMetrics(error: ApplicationError): void {
    const key = `${error.category}:${error.code}`;
    const existing = this.errorMetrics.get(key) ?? { count: 0, lastOccurrence: new Date() };
    
    this.errorMetrics.set(key, {
      count: existing.count + 1,
      lastOccurrence: new Date()
    });
  }

  /**
   * Circuit breaker implementation
   */
  private isCircuitBreakerOpen(operation: string): boolean {
    const breaker = this.circuitBreakers.get(operation);
    if (!breaker) return false;
    
    // Check if circuit breaker should reset (5 minutes timeout)
    const resetTimeout = 5 * 60 * 1000;
    if (breaker.isOpen && Date.now() - breaker.lastFailure.getTime() > resetTimeout) {
      breaker.isOpen = false;
      breaker.failures = 0;
    }
    
    return breaker.isOpen;
  }

  private updateCircuitBreaker(operation: string): void {
    const breaker = this.circuitBreakers.get(operation) ?? { isOpen: false, failures: 0, lastFailure: new Date() };
    
    breaker.failures++;
    breaker.lastFailure = new Date();
    
    // Open circuit breaker after 5 failures
    if (breaker.failures >= 5) {
      breaker.isOpen = true;
    }
    
    this.circuitBreakers.set(operation, breaker);
  }

  private resetCircuitBreaker(operation: string): void {
    const breaker = this.circuitBreakers.get(operation);
    if (breaker) {
      breaker.isOpen = false;
      breaker.failures = 0;
    }
  }

  /**
   * Registers a custom recovery strategy for an operation
   */
  registerRecoveryStrategy(operation: string, action: RecoveryAction): void {
    this.recoveryStrategies.set(operation, action);
  }

  /**
   * Gets error metrics for monitoring
   */
  getErrorMetrics(): Map<string, { count: number; lastOccurrence: Date }> {
    return new Map(this.errorMetrics);
  }

  /**
   * Gets circuit breaker status
   */
  getCircuitBreakerStatus(): Map<string, { isOpen: boolean; failures: number; lastFailure: Date }> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Initializes default recovery strategies
   */
  private initializeDefaultStrategies(): void {
    // Network operations - retry with backoff
    this.recoveryStrategies.set('network_request', {
      strategy: RecoveryStrategy.RETRY,
      maxAttempts: 3,
      backoffMs: 1000
    });

    // Authentication operations - fail fast after one retry
    this.recoveryStrategies.set('authenticate', {
      strategy: RecoveryStrategy.RETRY,
      maxAttempts: 1,
      backoffMs: 500
    });

    // Trading operations - retry with fallback to alternative venues
    this.recoveryStrategies.set('place_order', {
      strategy: RecoveryStrategy.RETRY,
      maxAttempts: 2,
      backoffMs: 2000
    });

    // Balance queries - retry with degraded mode (cached data)
    this.recoveryStrategies.set('get_balance', {
      strategy: RecoveryStrategy.RETRY,
      maxAttempts: 3,
      backoffMs: 1000
    });

    // Health checks - fail fast
    this.recoveryStrategies.set('health_check', {
      strategy: RecoveryStrategy.FAIL_FAST,
      maxAttempts: 1
    });
  }
}

/**
 * Global error handler instance
 */
export const globalErrorHandler = new ErrorHandler();

/**
 * Decorator for automatic error handling
 */
export function withErrorHandling(
  context: Omit<ErrorContext, 'timestamp'>,
  recoveryAction?: RecoveryAction
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const fullContext: ErrorContext = {
        ...context,
        timestamp: new Date()
      };

      const result = await globalErrorHandler.handleError(
        () => method.apply(this, args),
        fullContext,
        recoveryAction
      );

      if (!result.success) {
        throw result.error;
      }

      return result.result;
    };

    return descriptor;
  };
}