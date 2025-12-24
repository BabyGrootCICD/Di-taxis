/**
 * Tests for Configuration Manager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ConfigurationManager, ApplicationConfig } from './ConfigurationManager';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;

  beforeEach(() => {
    configManager = new ConfigurationManager();
  });

  describe('Configuration Loading and Validation', () => {
    it('should load default configuration successfully', async () => {
      await configManager.loadConfiguration();
      const config = configManager.getConfiguration();
      
      expect(config).toBeDefined();
      expect(config.environment).toBe('development');
      expect(config.version).toBe('1.0.0');
      expect(config.port).toBe(3000);
    });

    it('should validate configuration correctly', () => {
      const config = configManager.getConfiguration();
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid port numbers', () => {
      const config = configManager.getConfiguration();
      config.port = -1;
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'port')).toBe(true);
    });

    it('should reject invalid environment values', () => {
      const config = configManager.getConfiguration();
      (config as any).environment = 'invalid';
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'environment')).toBe(true);
    });
  });

  describe('Configuration Sections', () => {
    it('should get specific configuration sections', () => {
      const databaseConfig = configManager.getConfigSection('database');
      
      expect(databaseConfig).toBeDefined();
      expect(databaseConfig.host).toBe('localhost');
      expect(databaseConfig.port).toBe(5432);
    });

    it('should update configuration sections', () => {
      const originalPort = configManager.getConfigSection('database').port;
      
      configManager.updateConfigSection('database', { port: 5433 });
      
      const updatedPort = configManager.getConfigSection('database').port;
      expect(updatedPort).toBe(5433);
      expect(updatedPort).not.toBe(originalPort);
    });

    it('should validate configuration after section updates', () => {
      expect(() => {
        configManager.updateConfigSection('database', { port: -1 });
      }).toThrow();
    });
  });

  describe('Environment-Specific Configuration', () => {
    it('should provide development environment configuration', () => {
      const devConfig = configManager.getEnvironmentConfiguration('development');
      
      expect(devConfig.logLevel).toBe('debug');
      expect(devConfig.monitoring?.enableDetailedLogging).toBe(true);
    });

    it('should provide production environment configuration', () => {
      const prodConfig = configManager.getEnvironmentConfiguration('production');
      
      expect(prodConfig.logLevel).toBe('warn');
      expect(prodConfig.security?.enableTwoFactor).toBe(true);
      expect(prodConfig.monitoring?.enableDetailedLogging).toBe(false);
    });

    it('should provide staging environment configuration', () => {
      const stagingConfig = configManager.getEnvironmentConfiguration('staging');
      
      expect(stagingConfig.logLevel).toBe('info');
      expect(stagingConfig.security?.sessionTimeout).toBe(1800000);
    });
  });

  describe('Database Configuration Validation', () => {
    it('should validate database host', () => {
      const config = configManager.getConfiguration();
      config.database.host = '';
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'database.host')).toBe(true);
    });

    it('should validate database port range', () => {
      const config = configManager.getConfiguration();
      config.database.port = 70000;
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'database.port')).toBe(true);
    });

    it('should validate connection timeout', () => {
      const config = configManager.getConfiguration();
      config.database.connectionTimeout = 500;
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'database.connectionTimeout')).toBe(true);
    });
  });

  describe('Security Configuration Validation', () => {
    it('should validate key length', () => {
      const config = configManager.getConfiguration();
      config.security.keyLength = 8;
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'security.keyLength')).toBe(true);
    });

    it('should validate session timeout', () => {
      const config = configManager.getConfiguration();
      config.security.sessionTimeout = 60000; // 1 minute - too short
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'security.sessionTimeout')).toBe(true);
    });

    it('should validate password minimum length', () => {
      const config = configManager.getConfiguration();
      config.security.passwordMinLength = 4;
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'security.passwordMinLength')).toBe(true);
    });
  });

  describe('Trading Configuration Validation', () => {
    it('should validate slippage percentages', () => {
      const config = configManager.getConfiguration();
      config.trading.defaultSlippagePercent = 150; // Invalid - over 100%
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'trading.defaultSlippagePercent')).toBe(true);
    });

    it('should validate max slippage is greater than default', () => {
      const config = configManager.getConfiguration();
      config.trading.defaultSlippagePercent = 5.0;
      config.trading.maxSlippagePercent = 2.0; // Invalid - less than default
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'trading.maxSlippagePercent')).toBe(true);
    });

    it('should validate order timeout', () => {
      const config = configManager.getConfiguration();
      config.trading.orderTimeoutMs = 500; // Too short
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'trading.orderTimeoutMs')).toBe(true);
    });
  });

  describe('Monitoring Configuration Validation', () => {
    it('should validate health check interval', () => {
      const config = configManager.getConfiguration();
      config.monitoring.healthCheckInterval = 500; // Too short
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'monitoring.healthCheckInterval')).toBe(true);
    });

    it('should validate alert thresholds', () => {
      const config = configManager.getConfiguration();
      config.monitoring.alertThresholds.errorRate = 150; // Invalid - over 100%
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'monitoring.alertThresholds.errorRate')).toBe(true);
    });

    it('should validate memory usage threshold', () => {
      const config = configManager.getConfiguration();
      config.monitoring.alertThresholds.memoryUsage = -10; // Invalid - negative
      
      const validation = configManager.validateConfiguration(config);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(e => e.path === 'monitoring.alertThresholds.memoryUsage')).toBe(true);
    });
  });

  describe('Configuration Encryption', () => {
    it('should encrypt and save configuration', async () => {
      const config = configManager.getConfiguration();
      
      // This should not throw
      await expect(configManager.saveConfiguration(config)).resolves.not.toThrow();
    });

    it('should not save invalid configuration', async () => {
      const config = configManager.getConfiguration();
      config.port = -1; // Invalid
      
      await expect(configManager.saveConfiguration(config)).rejects.toThrow();
    });
  });

  describe('Environment Variable Loading', () => {
    it('should handle missing environment variables gracefully', async () => {
      // Clear environment variables
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      
      await configManager.loadConfiguration();
      const config = configManager.getConfiguration();
      
      expect(config.environment).toBe('development'); // Default value
      
      // Restore environment
      if (originalEnv) {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});