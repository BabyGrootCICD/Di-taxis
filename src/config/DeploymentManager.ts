/**
 * Deployment Manager for handling deployment-specific configuration and setup
 */

import { ConfigurationService } from '../services/ConfigurationService';
import { SecurityManager } from '../security/SecurityManager';
import { ApplicationConfig } from './ConfigurationManager';

export interface DeploymentEnvironment {
  name: string;
  description: string;
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  securityRequirements: {
    requireHttps: boolean;
    requireAuthentication: boolean;
    requireEncryption: boolean;
  };
}

export interface DeploymentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  environment: string;
}

export interface DeploymentStatus {
  environment: string;
  version: string;
  deployedAt: Date;
  configurationValid: boolean;
  securityChecksPass: boolean;
  servicesHealthy: boolean;
}

export class DeploymentManager {
  private configService: ConfigurationService;
  private securityManager: SecurityManager;
  private environments: Map<string, DeploymentEnvironment> = new Map();

  constructor(configService: ConfigurationService, securityManager: SecurityManager) {
    this.configService = configService;
    this.securityManager = securityManager;
    this.initializeEnvironments();
  }

  /**
   * Validates deployment readiness for a specific environment
   */
  async validateDeployment(environment: string): Promise<DeploymentValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const envConfig = this.environments.get(environment);
    if (!envConfig) {
      errors.push(`Unknown environment: ${environment}`);
      return {
        isValid: false,
        errors,
        warnings,
        environment
      };
    }

    // Validate configuration
    const configValidation = this.configService.validateConfiguration();
    if (!configValidation.isValid) {
      errors.push(...configValidation.errors);
    }

    // Validate environment variables
    const envVarValidation = this.validateEnvironmentVariables(envConfig);
    errors.push(...envVarValidation.errors);
    warnings.push(...envVarValidation.warnings);

    // Validate security requirements
    const securityValidation = this.validateSecurityRequirements(envConfig);
    errors.push(...securityValidation.errors);
    warnings.push(...securityValidation.warnings);

    // Environment-specific validations
    if (environment === 'production') {
      const prodValidation = this.validateProductionRequirements();
      errors.push(...prodValidation.errors);
      warnings.push(...prodValidation.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      environment
    };
  }

  /**
   * Prepares configuration for deployment
   */
  async prepareDeployment(environment: string): Promise<ApplicationConfig> {
    const validation = await this.validateDeployment(environment);
    if (!validation.isValid) {
      throw new Error(`Deployment validation failed: ${validation.errors.join(', ')}`);
    }

    // Get base configuration
    const config = this.configService.getConfiguration();

    // Apply environment-specific overrides
    const envOverrides = this.configService.getEnvironmentConfiguration(
      environment as 'development' | 'staging' | 'production'
    );

    // Merge configurations
    const deploymentConfig: ApplicationConfig = {
      ...config,
      ...envOverrides,
      environment: environment as 'development' | 'staging' | 'production'
    };

    // Apply deployment-specific security settings
    if (environment === 'production') {
      deploymentConfig.security = {
        ...deploymentConfig.security,
        enableTwoFactor: true,
        sessionTimeout: 3600000, // 1 hour
        maxLoginAttempts: 3
      };
    }

    return deploymentConfig;
  }

  /**
   * Gets deployment status
   */
  async getDeploymentStatus(): Promise<DeploymentStatus> {
    const config = this.configService.getConfiguration();
    const configValidation = this.configService.validateConfiguration();
    
    return {
      environment: config.environment,
      version: config.version,
      deployedAt: new Date(), // In real implementation, this would be stored
      configurationValid: configValidation.isValid,
      securityChecksPass: await this.performSecurityChecks(),
      servicesHealthy: await this.checkServicesHealth()
    };
  }

  /**
   * Generates deployment checklist
   */
  generateDeploymentChecklist(environment: string): string[] {
    const envConfig = this.environments.get(environment);
    if (!envConfig) {
      return [`Error: Unknown environment ${environment}`];
    }

    const checklist: string[] = [
      '□ Configuration validation passed',
      '□ Environment variables set',
      '□ Security requirements met',
      '□ Database connectivity verified',
      '□ External service connections tested',
      '□ SSL/TLS certificates configured',
      '□ Monitoring and alerting configured',
      '□ Backup and recovery procedures tested',
      '□ Performance benchmarks met',
      '□ Security scan completed'
    ];

    if (environment === 'production') {
      checklist.push(
        '□ Load balancer configured',
        '□ Auto-scaling policies set',
        '□ Disaster recovery plan activated',
        '□ Compliance requirements verified'
      );
    }

    return checklist;
  }

  /**
   * Initializes deployment environments
   */
  private initializeEnvironments(): void {
    this.environments.set('development', {
      name: 'Development',
      description: 'Local development environment',
      requiredEnvVars: ['NODE_ENV'],
      optionalEnvVars: ['PORT', 'HOST', 'LOG_LEVEL'],
      securityRequirements: {
        requireHttps: false,
        requireAuthentication: false,
        requireEncryption: true
      }
    });

    this.environments.set('staging', {
      name: 'Staging',
      description: 'Pre-production testing environment',
      requiredEnvVars: ['NODE_ENV', 'DB_HOST', 'DB_USER', 'DB_PASSWORD'],
      optionalEnvVars: ['PORT', 'HOST', 'LOG_LEVEL'],
      securityRequirements: {
        requireHttps: true,
        requireAuthentication: true,
        requireEncryption: true
      }
    });

    this.environments.set('production', {
      name: 'Production',
      description: 'Live production environment',
      requiredEnvVars: [
        'NODE_ENV',
        'DB_HOST',
        'DB_USER',
        'DB_PASSWORD',
        'MASTER_KEY'
      ],
      optionalEnvVars: ['PORT', 'HOST'],
      securityRequirements: {
        requireHttps: true,
        requireAuthentication: true,
        requireEncryption: true
      }
    });
  }

  /**
   * Validates environment variables
   */
  private validateEnvironmentVariables(envConfig: DeploymentEnvironment): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required environment variables
    for (const envVar of envConfig.requiredEnvVars) {
      if (!process.env[envVar]) {
        errors.push(`Required environment variable ${envVar} is not set`);
      }
    }

    // Check optional environment variables
    for (const envVar of envConfig.optionalEnvVars) {
      if (!process.env[envVar]) {
        warnings.push(`Optional environment variable ${envVar} is not set`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Validates security requirements
   */
  private validateSecurityRequirements(envConfig: DeploymentEnvironment): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = this.configService.getConfiguration();

    if (envConfig.securityRequirements.requireHttps) {
      // In a real implementation, check if HTTPS is configured
      if (config.environment === 'production' && config.host === 'localhost') {
        warnings.push('Production environment should not use localhost');
      }
    }

    if (envConfig.securityRequirements.requireAuthentication) {
      const securityConfig = this.configService.getSecurityConfig();
      if (securityConfig.sessionTimeout > 7200000) { // 2 hours
        warnings.push('Session timeout is longer than recommended for secure environments');
      }
    }

    if (envConfig.securityRequirements.requireEncryption) {
      const securityConfig = this.configService.getSecurityConfig();
      if (securityConfig.keyLength < 32) {
        errors.push('Encryption key length must be at least 32 bytes for secure environments');
      }
    }

    return { errors, warnings };
  }

  /**
   * Validates production-specific requirements
   */
  private validateProductionRequirements(): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = this.configService.getConfiguration();

    // Check production-specific settings
    if (config.logLevel === 'debug') {
      warnings.push('Debug logging should not be enabled in production');
    }

    const monitoringConfig = this.configService.getMonitoringConfig();
    if (monitoringConfig.enableDetailedLogging) {
      warnings.push('Detailed logging should be disabled in production for performance');
    }

    const securityConfig = this.configService.getSecurityConfig();
    if (!securityConfig.enableTwoFactor) {
      warnings.push('Two-factor authentication should be enabled in production');
    }

    // Check database configuration
    const dbConfig = this.configService.getDatabaseConfig();
    if (!dbConfig.ssl) {
      errors.push('SSL must be enabled for database connections in production');
    }

    return { errors, warnings };
  }

  /**
   * Performs security checks
   */
  private async performSecurityChecks(): Promise<boolean> {
    try {
      // Check if security manager is properly initialized
      const testData = 'test-data';
      const encrypted = this.securityManager.encryptSensitiveData(testData);
      const decrypted = this.securityManager.decryptSensitiveData(encrypted);
      
      return decrypted === testData;
    } catch (error) {
      return false;
    }
  }

  /**
   * Checks services health
   */
  private async checkServicesHealth(): Promise<boolean> {
    // In a real implementation, this would check all services
    // For now, just check if configuration is valid
    const validation = this.configService.validateConfiguration();
    return validation.isValid;
  }

  /**
   * Gets available environments
   */
  getAvailableEnvironments(): string[] {
    return Array.from(this.environments.keys());
  }

  /**
   * Gets environment details
   */
  getEnvironmentDetails(environment: string): DeploymentEnvironment | null {
    return this.environments.get(environment) || null;
  }
}