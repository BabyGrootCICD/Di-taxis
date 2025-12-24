/**
 * Tests for Configuration Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigurationService } from './ConfigurationService';
import { AuditService } from './AuditService';

describe('ConfigurationService', () => {
  let configService: ConfigurationService;
  let mockAuditService: AuditService;

  beforeEach(() => {
    mockAuditService = new AuditService();
    configService = new ConfigurationService(mockAuditService);
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(configService.initialize()).resolves.not.toThrow();
    });

    it('should load configuration during initialization', async () => {
      await configService.initialize();
      
      const config = configService.getConfiguration();
      expect(config).toBeDefined();
      expect(config.environment).toBe('development');
    });
  });

  describe('Configuration Access', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should get complete configuration', () => {
      const config = configService.getConfiguration();
      
      expect(config).toBeDefined();
      expect(config.version).toBe('1.0.0');
      expect(config.port).toBe(3000);
    });

    it('should get specific configuration sections', () => {
      const databaseConfig = configService.getConfigSection('database');
      
      expect(databaseConfig).toBeDefined();
      expect(databaseConfig.host).toBe('localhost');
      expect(databaseConfig.port).toBe(5432);
    });

    it('should get database configuration', () => {
      const dbConfig = configService.getDatabaseConfig();
      
      expect(dbConfig.host).toBe('localhost');
      expect(dbConfig.port).toBe(5432);
      expect(dbConfig.ssl).toBe(true);
    });

    it('should get security configuration', () => {
      const securityConfig = configService.getSecurityConfig();
      
      expect(securityConfig.encryptionAlgorithm).toBe('aes-256-cbc');
      expect(securityConfig.keyLength).toBe(32);
    });

    it('should get trading configuration', () => {
      const tradingConfig = configService.getTradingConfig();
      
      expect(tradingConfig.defaultSlippagePercent).toBe(1.0);
      expect(tradingConfig.maxSlippagePercent).toBe(5.0);
    });

    it('should get monitoring configuration', () => {
      const monitoringConfig = configService.getMonitoringConfig();
      
      expect(monitoringConfig.healthCheckInterval).toBe(30000);
      expect(monitoringConfig.metricsRetentionDays).toBe(30);
    });

    it('should get exchange configuration', () => {
      const exchangeConfig = configService.getExchangeConfig();
      
      expect(exchangeConfig.bitfinex).toBeDefined();
      expect(exchangeConfig.bitfinex.name).toBe('Bitfinex');
    });

    it('should get blockchain configuration', () => {
      const blockchainConfig = configService.getBlockchainConfig();
      
      expect(blockchainConfig.ethereum).toBeDefined();
      expect(blockchainConfig.ethereum.confirmationThreshold).toBe(12);
    });
  });

  describe('Configuration Updates', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should update configuration section successfully', async () => {
      const originalPort = configService.getConfigSection('database').port;
      
      await configService.updateConfigSection('database', { port: 5433 });
      
      const updatedPort = configService.getConfigSection('database').port;
      expect(updatedPort).toBe(5433);
      expect(updatedPort).not.toBe(originalPort);
    });

    it('should validate configuration after updates', async () => {
      await expect(
        configService.updateConfigSection('database', { port: -1 })
      ).rejects.toThrow();
    });

    it('should notify change listeners on updates', async () => {
      let changeEventReceived = false;
      
      configService.addChangeListener((event) => {
        changeEventReceived = true;
        expect(event.section).toBe('database');
        expect(event.newValue.port).toBe(5433);
      });
      
      await configService.updateConfigSection('database', { port: 5433 });
      
      expect(changeEventReceived).toBe(true);
    });
  });

  describe('Configuration Validation', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should validate valid configuration', () => {
      const validation = configService.validateConfiguration();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Environment Detection', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should detect development environment', () => {
      expect(configService.isDevelopment()).toBe(true);
      expect(configService.isProduction()).toBe(false);
    });

    it('should get application version', () => {
      expect(configService.getVersion()).toBe('1.0.0');
    });

    it('should get server configuration', () => {
      const serverConfig = configService.getServerConfig();
      
      expect(serverConfig.host).toBe('localhost');
      expect(serverConfig.port).toBe(3000);
    });
  });

  describe('Environment-Specific Configuration', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should get development environment configuration', () => {
      const devConfig = configService.getEnvironmentConfiguration('development');
      
      expect(devConfig.logLevel).toBe('debug');
      expect(devConfig.monitoring?.enableDetailedLogging).toBe(true);
    });

    it('should get production environment configuration', () => {
      const prodConfig = configService.getEnvironmentConfiguration('production');
      
      expect(prodConfig.logLevel).toBe('warn');
      expect(prodConfig.security?.enableTwoFactor).toBe(true);
    });

    it('should get staging environment configuration', () => {
      const stagingConfig = configService.getEnvironmentConfiguration('staging');
      
      expect(stagingConfig.logLevel).toBe('info');
      expect(stagingConfig.security?.sessionTimeout).toBe(1800000);
    });
  });

  describe('Configuration Reload', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should reload configuration successfully', async () => {
      await expect(configService.reloadConfiguration()).resolves.not.toThrow();
    });
  });

  describe('Change Listeners', () => {
    beforeEach(async () => {
      await configService.initialize();
    });

    it('should add and remove change listeners', () => {
      const listener = vi.fn();
      
      configService.addChangeListener(listener);
      configService.removeChangeListener(listener);
      
      // Listener should not be called after removal
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', async () => {
      const faultyListener = () => {
        throw new Error('Listener error');
      };
      
      configService.addChangeListener(faultyListener);
      
      // Should not throw even with faulty listener
      await expect(
        configService.updateConfigSection('database', { port: 5433 })
      ).resolves.not.toThrow();
    });
  });
});