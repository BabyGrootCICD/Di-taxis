/**
 * Configuration Manager for application settings and environment-specific configuration
 */

import * as crypto from 'crypto';
import { SecurityManager } from '../security/SecurityManager';
import { DataClassifier } from '../security/DataClassifier';
import { InputValidator } from '../security/InputValidator';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  connectionTimeout: number;
  maxConnections: number;
}

export interface SecurityConfig {
  encryptionAlgorithm: string;
  keyLength: number;
  sessionTimeout: number;
  maxLoginAttempts: number;
  passwordMinLength: number;
  enableTwoFactor: boolean;
}

export interface TradingConfig {
  defaultSlippagePercent: number;
  maxSlippagePercent: number;
  orderTimeoutMs: number;
  maxOrderRetries: number;
  enableSlippageProtection: boolean;
  maxOrderSize: number;
}

export interface MonitoringConfig {
  healthCheckInterval: number;
  metricsRetentionDays: number;
  alertThresholds: {
    errorRate: number;
    responseTime: number;
    memoryUsage: number;
    cpuUsage: number;
  };
  enableDetailedLogging: boolean;
}

export interface ExchangeConfig {
  [venueId: string]: {
    name: string;
    apiUrl: string;
    websocketUrl?: string;
    rateLimitPerSecond: number;
    timeout: number;
    retryAttempts: number;
    enabled: boolean;
  };
}

export interface BlockchainConfig {
  [network: string]: {
    rpcUrl: string;
    confirmationThreshold: number;
    blockTime: number;
    gasLimit: number;
    enabled: boolean;
  };
}

export interface ApplicationConfig {
  environment: 'development' | 'staging' | 'production';
  version: string;
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  database: DatabaseConfig;
  security: SecurityConfig;
  trading: TradingConfig;
  monitoring: MonitoringConfig;
  exchanges: ExchangeConfig;
  blockchain: BlockchainConfig;
}

export interface ConfigValidationError {
  path: string;
  message: string;
  value?: any;
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: ConfigValidationError[];
}

export interface EnvironmentVariables {
  NODE_ENV?: string;
  PORT?: string;
  HOST?: string;
  LOG_LEVEL?: string;
  DB_HOST?: string;
  DB_PORT?: string;
  DB_NAME?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  MASTER_KEY?: string;
  [key: string]: string | undefined;
}

export class ConfigurationManager {
  private config: ApplicationConfig;
  private securityManager: SecurityManager;
  private dataClassifier: DataClassifier;
  private inputValidator: InputValidator;
  private readonly configFilePath: string;
  private readonly encryptedConfigPath: string;

  constructor(
    configFilePath: string = './config/app.json',
    encryptedConfigPath: string = './config/app.encrypted.json'
  ) {
    this.configFilePath = configFilePath;
    this.encryptedConfigPath = encryptedConfigPath;
    this.securityManager = new SecurityManager();
    this.dataClassifier = new DataClassifier();
    this.inputValidator = new InputValidator();
    
    // Initialize with default configuration
    this.config = this.getDefaultConfiguration();
  }

  /**
   * Loads configuration from file and environment variables
   */
  async loadConfiguration(): Promise<void> {
    try {
      // Load base configuration from file
      const fileConfig = await this.loadConfigurationFromFile();
      
      // Override with environment variables
      const envConfig = this.loadConfigurationFromEnvironment();
      
      // Merge configurations (environment takes precedence)
      this.config = this.mergeConfigurations(fileConfig, envConfig);
      
      // Validate the final configuration
      const validation = this.validateConfiguration(this.config);
      if (!validation.isValid) {
        throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load configuration: ${errorMessage}`);
    }
  }

  /**
   * Saves configuration to encrypted file
   */
  async saveConfiguration(config?: ApplicationConfig): Promise<void> {
    const configToSave = config || this.config;
    
    // Validate configuration before saving
    const validation = this.validateConfiguration(configToSave);
    if (!validation.isValid) {
      throw new Error(`Cannot save invalid configuration: ${validation.errors.map(e => e.message).join(', ')}`);
    }

    try {
      // Encrypt sensitive configuration data
      const encryptedConfig = this.encryptSensitiveConfiguration(configToSave);
      
      // In a real implementation, this would write to file system
      // For now, we'll store in memory
      this.config = configToSave;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to save configuration: ${errorMessage}`);
    }
  }

  /**
   * Gets the current configuration
   */
  getConfiguration(): ApplicationConfig {
    return { ...this.config };
  }

  /**
   * Gets a specific configuration section
   */
  getConfigSection<T extends keyof ApplicationConfig>(section: T): ApplicationConfig[T] {
    return { ...this.config[section] } as ApplicationConfig[T];
  }

  /**
   * Updates a configuration section
   */
  updateConfigSection<T extends keyof ApplicationConfig>(
    section: T, 
    updates: Partial<ApplicationConfig[T]>
  ): void {
    this.config[section] = {
      ...this.config[section],
      ...updates
    } as ApplicationConfig[T];
    
    // Validate after update
    const validation = this.validateConfiguration(this.config);
    if (!validation.isValid) {
      throw new Error(`Configuration update failed validation: ${validation.errors.map(e => e.message).join(', ')}`);
    }
  }

  /**
   * Validates the entire configuration
   */
  validateConfiguration(config: ApplicationConfig): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];

    // Validate environment
    if (!['development', 'staging', 'production'].includes(config.environment)) {
      errors.push({
        path: 'environment',
        message: 'Environment must be development, staging, or production',
        value: config.environment
      });
    }

    // Validate port
    if (config.port < 1 || config.port > 65535) {
      errors.push({
        path: 'port',
        message: 'Port must be between 1 and 65535',
        value: config.port
      });
    }

    // Validate database configuration
    const dbErrors = this.validateDatabaseConfig(config.database);
    errors.push(...dbErrors);

    // Validate security configuration
    const securityErrors = this.validateSecurityConfig(config.security);
    errors.push(...securityErrors);

    // Validate trading configuration
    const tradingErrors = this.validateTradingConfig(config.trading);
    errors.push(...tradingErrors);

    // Validate monitoring configuration
    const monitoringErrors = this.validateMonitoringConfig(config.monitoring);
    errors.push(...monitoringErrors);

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Gets environment-specific configuration overrides
   */
  private loadConfigurationFromEnvironment(): Partial<ApplicationConfig> {
    const env: EnvironmentVariables = process.env;
    
    const envConfig: Partial<ApplicationConfig> = {};

    if (env.NODE_ENV && ['development', 'staging', 'production'].includes(env.NODE_ENV)) {
      envConfig.environment = env.NODE_ENV as 'development' | 'staging' | 'production';
    }

    if (env.PORT) {
      envConfig.port = parseInt(env.PORT, 10);
    }

    if (env.HOST) {
      envConfig.host = env.HOST;
    }

    if (env.LOG_LEVEL) {
      envConfig.logLevel = env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
    }

    // Database configuration from environment
    if (env.DB_HOST || env.DB_PORT || env.DB_NAME || env.DB_USER || env.DB_PASSWORD) {
      envConfig.database = {
        ...this.config.database,
        ...(env.DB_HOST && { host: env.DB_HOST }),
        ...(env.DB_PORT && { port: parseInt(env.DB_PORT, 10) }),
        ...(env.DB_NAME && { database: env.DB_NAME }),
        ...(env.DB_USER && { username: env.DB_USER }),
        ...(env.DB_PASSWORD && { password: env.DB_PASSWORD })
      };
    }

    return envConfig;
  }

  /**
   * Loads configuration from file
   */
  private async loadConfigurationFromFile(): Promise<ApplicationConfig> {
    // In a real implementation, this would read from the file system
    // For now, return default configuration
    return this.getDefaultConfiguration();
  }

  /**
   * Encrypts sensitive configuration data
   */
  private encryptSensitiveConfiguration(config: ApplicationConfig): string {
    // Identify sensitive fields that need encryption
    const sensitiveConfig = {
      database: {
        password: config.database.password,
        username: config.database.username
      }
    };

    // Apply data classification and encrypt sensitive data
    const classifiedData = this.dataClassifier.applyRedactionPolicies(sensitiveConfig, 'storage');
    return this.securityManager.encryptSensitiveData(JSON.stringify(classifiedData));
  }

  /**
   * Merges two configuration objects with precedence
   */
  private mergeConfigurations(
    base: ApplicationConfig, 
    override: Partial<ApplicationConfig>
  ): ApplicationConfig {
    return {
      ...base,
      ...override,
      database: { ...base.database, ...override.database },
      security: { ...base.security, ...override.security },
      trading: { ...base.trading, ...override.trading },
      monitoring: { ...base.monitoring, ...override.monitoring },
      exchanges: { ...base.exchanges, ...override.exchanges },
      blockchain: { ...base.blockchain, ...override.blockchain }
    };
  }

  /**
   * Gets default configuration
   */
  private getDefaultConfiguration(): ApplicationConfig {
    return {
      environment: 'development',
      version: '1.0.0',
      port: 3000,
      host: 'localhost',
      logLevel: 'info',
      database: {
        host: 'localhost',
        port: 5432,
        database: 'gold_router',
        username: 'app_user',
        password: 'secure_password',
        ssl: true,
        connectionTimeout: 30000,
        maxConnections: 10
      },
      security: {
        encryptionAlgorithm: 'aes-256-cbc',
        keyLength: 32,
        sessionTimeout: 3600000, // 1 hour
        maxLoginAttempts: 5,
        passwordMinLength: 12,
        enableTwoFactor: true
      },
      trading: {
        defaultSlippagePercent: 1.0,
        maxSlippagePercent: 5.0,
        orderTimeoutMs: 30000,
        maxOrderRetries: 3,
        enableSlippageProtection: true,
        maxOrderSize: 1000000 // in base currency units
      },
      monitoring: {
        healthCheckInterval: 30000, // 30 seconds
        metricsRetentionDays: 30,
        alertThresholds: {
          errorRate: 5.0, // 5%
          responseTime: 2000, // 2 seconds
          memoryUsage: 80.0, // 80%
          cpuUsage: 75.0 // 75%
        },
        enableDetailedLogging: false
      },
      exchanges: {
        bitfinex: {
          name: 'Bitfinex',
          apiUrl: 'https://api.bitfinex.com',
          websocketUrl: 'wss://api.bitfinex.com/ws/2',
          rateLimitPerSecond: 10,
          timeout: 10000,
          retryAttempts: 3,
          enabled: true
        }
      },
      blockchain: {
        ethereum: {
          rpcUrl: 'https://mainnet.infura.io/v3/YOUR_PROJECT_ID',
          confirmationThreshold: 12,
          blockTime: 15000, // 15 seconds
          gasLimit: 200000,
          enabled: true
        }
      }
    };
  }

  /**
   * Validates database configuration
   */
  private validateDatabaseConfig(config: DatabaseConfig): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    if (!config.host || config.host.trim().length === 0) {
      errors.push({
        path: 'database.host',
        message: 'Database host is required',
        value: config.host
      });
    }

    if (config.port < 1 || config.port > 65535) {
      errors.push({
        path: 'database.port',
        message: 'Database port must be between 1 and 65535',
        value: config.port
      });
    }

    if (!config.database || config.database.trim().length === 0) {
      errors.push({
        path: 'database.database',
        message: 'Database name is required',
        value: config.database
      });
    }

    if (config.connectionTimeout < 1000) {
      errors.push({
        path: 'database.connectionTimeout',
        message: 'Connection timeout must be at least 1000ms',
        value: config.connectionTimeout
      });
    }

    if (config.maxConnections < 1) {
      errors.push({
        path: 'database.maxConnections',
        message: 'Max connections must be at least 1',
        value: config.maxConnections
      });
    }

    return errors;
  }

  /**
   * Validates security configuration
   */
  private validateSecurityConfig(config: SecurityConfig): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    if (config.keyLength < 16) {
      errors.push({
        path: 'security.keyLength',
        message: 'Key length must be at least 16 bytes',
        value: config.keyLength
      });
    }

    if (config.sessionTimeout < 300000) { // 5 minutes minimum
      errors.push({
        path: 'security.sessionTimeout',
        message: 'Session timeout must be at least 5 minutes (300000ms)',
        value: config.sessionTimeout
      });
    }

    if (config.maxLoginAttempts < 1) {
      errors.push({
        path: 'security.maxLoginAttempts',
        message: 'Max login attempts must be at least 1',
        value: config.maxLoginAttempts
      });
    }

    if (config.passwordMinLength < 8) {
      errors.push({
        path: 'security.passwordMinLength',
        message: 'Password minimum length must be at least 8',
        value: config.passwordMinLength
      });
    }

    return errors;
  }

  /**
   * Validates trading configuration
   */
  private validateTradingConfig(config: TradingConfig): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    if (config.defaultSlippagePercent < 0 || config.defaultSlippagePercent > 100) {
      errors.push({
        path: 'trading.defaultSlippagePercent',
        message: 'Default slippage percent must be between 0 and 100',
        value: config.defaultSlippagePercent
      });
    }

    if (config.maxSlippagePercent < config.defaultSlippagePercent) {
      errors.push({
        path: 'trading.maxSlippagePercent',
        message: 'Max slippage percent must be greater than or equal to default slippage percent',
        value: config.maxSlippagePercent
      });
    }

    if (config.orderTimeoutMs < 1000) {
      errors.push({
        path: 'trading.orderTimeoutMs',
        message: 'Order timeout must be at least 1000ms',
        value: config.orderTimeoutMs
      });
    }

    if (config.maxOrderRetries < 0) {
      errors.push({
        path: 'trading.maxOrderRetries',
        message: 'Max order retries must be non-negative',
        value: config.maxOrderRetries
      });
    }

    if (config.maxOrderSize <= 0) {
      errors.push({
        path: 'trading.maxOrderSize',
        message: 'Max order size must be positive',
        value: config.maxOrderSize
      });
    }

    return errors;
  }

  /**
   * Validates monitoring configuration
   */
  private validateMonitoringConfig(config: MonitoringConfig): ConfigValidationError[] {
    const errors: ConfigValidationError[] = [];

    if (config.healthCheckInterval < 1000) {
      errors.push({
        path: 'monitoring.healthCheckInterval',
        message: 'Health check interval must be at least 1000ms',
        value: config.healthCheckInterval
      });
    }

    if (config.metricsRetentionDays < 1) {
      errors.push({
        path: 'monitoring.metricsRetentionDays',
        message: 'Metrics retention days must be at least 1',
        value: config.metricsRetentionDays
      });
    }

    const thresholds = config.alertThresholds;
    if (thresholds.errorRate < 0 || thresholds.errorRate > 100) {
      errors.push({
        path: 'monitoring.alertThresholds.errorRate',
        message: 'Error rate threshold must be between 0 and 100',
        value: thresholds.errorRate
      });
    }

    if (thresholds.responseTime < 0) {
      errors.push({
        path: 'monitoring.alertThresholds.responseTime',
        message: 'Response time threshold must be non-negative',
        value: thresholds.responseTime
      });
    }

    if (thresholds.memoryUsage < 0 || thresholds.memoryUsage > 100) {
      errors.push({
        path: 'monitoring.alertThresholds.memoryUsage',
        message: 'Memory usage threshold must be between 0 and 100',
        value: thresholds.memoryUsage
      });
    }

    if (thresholds.cpuUsage < 0 || thresholds.cpuUsage > 100) {
      errors.push({
        path: 'monitoring.alertThresholds.cpuUsage',
        message: 'CPU usage threshold must be between 0 and 100',
        value: thresholds.cpuUsage
      });
    }

    return errors;
  }

  /**
   * Reloads configuration from sources
   */
  async reloadConfiguration(): Promise<void> {
    await this.loadConfiguration();
  }

  /**
   * Gets configuration for a specific environment
   */
  getEnvironmentConfiguration(environment: 'development' | 'staging' | 'production'): Partial<ApplicationConfig> {
    const envConfigs = {
      development: {
        logLevel: 'debug' as const,
        monitoring: {
          ...this.config.monitoring,
          enableDetailedLogging: true
        }
      },
      staging: {
        logLevel: 'info' as const,
        security: {
          ...this.config.security,
          sessionTimeout: 1800000 // 30 minutes
        }
      },
      production: {
        logLevel: 'warn' as const,
        security: {
          ...this.config.security,
          sessionTimeout: 3600000, // 1 hour
          enableTwoFactor: true
        },
        monitoring: {
          ...this.config.monitoring,
          enableDetailedLogging: false
        }
      }
    };

    return envConfigs[environment];
  }
}