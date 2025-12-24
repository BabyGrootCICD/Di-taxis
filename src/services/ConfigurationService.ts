/**
 * Configuration Service for managing application configuration
 */

import { ConfigurationManager, ApplicationConfig } from '../config/ConfigurationManager';
import { AuditService } from './AuditService';

export interface ConfigurationChangeEvent {
  section: string;
  oldValue: any;
  newValue: any;
  timestamp: Date;
  userId?: string;
}

export class ConfigurationService {
  private configManager: ConfigurationManager;
  private auditService: AuditService;
  private changeListeners: ((event: ConfigurationChangeEvent) => void)[] = [];

  constructor(
    auditService: AuditService,
    configFilePath?: string,
    encryptedConfigPath?: string
  ) {
    this.configManager = new ConfigurationManager(configFilePath, encryptedConfigPath);
    this.auditService = auditService;
  }

  /**
   * Initializes the configuration service
   */
  async initialize(): Promise<void> {
    try {
      await this.configManager.loadConfiguration();
      
      // Log successful configuration load
      await this.auditService.logSecurityEvent('CONFIG_LOAD', {
        action: 'initialize',
        success: true,
        timestamp: new Date()
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log configuration load failure
      await this.auditService.logSecurityEvent('CONFIG_LOAD', {
        action: 'initialize',
        success: false,
        error: errorMessage,
        timestamp: new Date()
      });
      
      throw new Error(`Failed to initialize configuration service: ${errorMessage}`);
    }
  }

  /**
   * Gets the current application configuration
   */
  getConfiguration(): ApplicationConfig {
    return this.configManager.getConfiguration();
  }

  /**
   * Gets a specific configuration section
   */
  getConfigSection<T extends keyof ApplicationConfig>(section: T): ApplicationConfig[T] {
    return this.configManager.getConfigSection(section);
  }

  /**
   * Updates a configuration section with audit logging
   */
  async updateConfigSection<T extends keyof ApplicationConfig>(
    section: T,
    updates: Partial<ApplicationConfig[T]>,
    userId?: string
  ): Promise<void> {
    const oldValue = this.configManager.getConfigSection(section);
    
    try {
      this.configManager.updateConfigSection(section, updates);
      
      const newValue = this.configManager.getConfigSection(section);
      
      // Create change event
      const changeEvent: ConfigurationChangeEvent = {
        section: section as string,
        oldValue,
        newValue,
        timestamp: new Date(),
        userId
      };
      
      // Notify listeners
      this.notifyChangeListeners(changeEvent);
      
      // Log configuration change
      await this.auditService.logSecurityEvent('CONFIG_CHANGE', {
        action: 'updateConfigSection',
        section: section as string,
        userId,
        success: true,
        timestamp: new Date()
      });
      
      // Save configuration
      await this.configManager.saveConfiguration();
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log configuration change failure
      await this.auditService.logSecurityEvent('CONFIG_CHANGE', {
        action: 'updateConfigSection',
        section: section as string,
        userId,
        success: false,
        error: errorMessage,
        timestamp: new Date()
      });
      
      throw new Error(`Failed to update configuration section ${section as string}: ${errorMessage}`);
    }
  }

  /**
   * Validates the current configuration
   */
  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const validation = this.configManager.validateConfiguration(this.getConfiguration());
    return {
      isValid: validation.isValid,
      errors: validation.errors.map(e => `${e.path}: ${e.message}`)
    };
  }

  /**
   * Reloads configuration from sources
   */
  async reloadConfiguration(userId?: string): Promise<void> {
    try {
      await this.configManager.reloadConfiguration();
      
      // Log successful configuration reload
      await this.auditService.logSecurityEvent('CONFIG_RELOAD', {
        action: 'reloadConfiguration',
        userId,
        success: true,
        timestamp: new Date()
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log configuration reload failure
      await this.auditService.logSecurityEvent('CONFIG_RELOAD', {
        action: 'reloadConfiguration',
        userId,
        success: false,
        error: errorMessage,
        timestamp: new Date()
      });
      
      throw new Error(`Failed to reload configuration: ${errorMessage}`);
    }
  }

  /**
   * Gets configuration for a specific environment
   */
  getEnvironmentConfiguration(environment: 'development' | 'staging' | 'production'): Partial<ApplicationConfig> {
    return this.configManager.getEnvironmentConfiguration(environment);
  }

  /**
   * Adds a configuration change listener
   */
  addChangeListener(listener: (event: ConfigurationChangeEvent) => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * Removes a configuration change listener
   */
  removeChangeListener(listener: (event: ConfigurationChangeEvent) => void): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  /**
   * Gets database configuration for connection setup
   */
  getDatabaseConfig() {
    return this.getConfigSection('database');
  }

  /**
   * Gets security configuration for security manager setup
   */
  getSecurityConfig() {
    return this.getConfigSection('security');
  }

  /**
   * Gets trading configuration for trading engine setup
   */
  getTradingConfig() {
    return this.getConfigSection('trading');
  }

  /**
   * Gets monitoring configuration for monitoring service setup
   */
  getMonitoringConfig() {
    return this.getConfigSection('monitoring');
  }

  /**
   * Gets exchange configuration for connector setup
   */
  getExchangeConfig() {
    return this.getConfigSection('exchanges');
  }

  /**
   * Gets blockchain configuration for tracker setup
   */
  getBlockchainConfig() {
    return this.getConfigSection('blockchain');
  }

  /**
   * Checks if the application is running in development mode
   */
  isDevelopment(): boolean {
    return this.getConfiguration().environment === 'development';
  }

  /**
   * Checks if the application is running in production mode
   */
  isProduction(): boolean {
    return this.getConfiguration().environment === 'production';
  }

  /**
   * Gets the application version
   */
  getVersion(): string {
    return this.getConfiguration().version;
  }

  /**
   * Gets the server configuration (host and port)
   */
  getServerConfig(): { host: string; port: number } {
    const config = this.getConfiguration();
    return {
      host: config.host,
      port: config.port
    };
  }

  /**
   * Notifies all change listeners of a configuration change
   */
  private notifyChangeListeners(event: ConfigurationChangeEvent): void {
    this.changeListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        // Log listener error but don't fail the configuration update
        console.error('Configuration change listener error:', error);
      }
    });
  }
}