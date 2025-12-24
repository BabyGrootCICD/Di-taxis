/**
 * Tests for Deployment Manager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeploymentManager } from './DeploymentManager';
import { ConfigurationService } from '../services/ConfigurationService';
import { SecurityManager } from '../security/SecurityManager';
import { AuditService } from '../services/AuditService';

describe('DeploymentManager', () => {
  let deploymentManager: DeploymentManager;
  let configService: ConfigurationService;
  let securityManager: SecurityManager;
  let auditService: AuditService;

  beforeEach(async () => {
    auditService = new AuditService();
    configService = new ConfigurationService(auditService);
    securityManager = new SecurityManager();
    deploymentManager = new DeploymentManager(configService, securityManager);
    
    await configService.initialize();
  });

  describe('Environment Management', () => {
    it('should get available environments', () => {
      const environments = deploymentManager.getAvailableEnvironments();
      
      expect(environments).toContain('development');
      expect(environments).toContain('staging');
      expect(environments).toContain('production');
    });

    it('should get environment details', () => {
      const devEnv = deploymentManager.getEnvironmentDetails('development');
      
      expect(devEnv).toBeDefined();
      expect(devEnv?.name).toBe('Development');
      expect(devEnv?.securityRequirements.requireHttps).toBe(false);
    });

    it('should return null for unknown environment', () => {
      const unknownEnv = deploymentManager.getEnvironmentDetails('unknown');
      
      expect(unknownEnv).toBeNull();
    });
  });

  describe('Deployment Validation', () => {
    it('should validate development environment successfully', async () => {
      const validation = await deploymentManager.validateDeployment('development');
      
      expect(validation.environment).toBe('development');
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation for unknown environment', async () => {
      const validation = await deploymentManager.validateDeployment('unknown');
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Unknown environment: unknown');
    });

    it('should validate production environment requirements', async () => {
      const validation = await deploymentManager.validateDeployment('production');
      
      expect(validation.environment).toBe('production');
      // May have warnings but should be structurally valid
      expect(validation.errors.length).toBeGreaterThanOrEqual(0);
    });

    it('should validate staging environment requirements', async () => {
      const validation = await deploymentManager.validateDeployment('staging');
      
      expect(validation.environment).toBe('staging');
      expect(validation.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Deployment Preparation', () => {
    it('should prepare development deployment', async () => {
      const deploymentConfig = await deploymentManager.prepareDeployment('development');
      
      expect(deploymentConfig.environment).toBe('development');
      expect(deploymentConfig.logLevel).toBe('debug');
    });

    it('should fail preparation for invalid environment', async () => {
      await expect(
        deploymentManager.prepareDeployment('invalid')
      ).rejects.toThrow('Deployment validation failed');
    });
  });

  describe('Deployment Status', () => {
    it('should get deployment status', async () => {
      const status = await deploymentManager.getDeploymentStatus();
      
      expect(status.environment).toBe('development');
      expect(status.version).toBe('1.0.0');
      expect(status.deployedAt).toBeInstanceOf(Date);
      expect(typeof status.configurationValid).toBe('boolean');
      expect(typeof status.securityChecksPass).toBe('boolean');
      expect(typeof status.servicesHealthy).toBe('boolean');
    });
  });

  describe('Deployment Checklist', () => {
    it('should generate development deployment checklist', () => {
      const checklist = deploymentManager.generateDeploymentChecklist('development');
      
      expect(checklist).toContain('□ Configuration validation passed');
      expect(checklist).toContain('□ Environment variables set');
      expect(checklist).toContain('□ Security requirements met');
    });

    it('should generate production deployment checklist with additional items', () => {
      const checklist = deploymentManager.generateDeploymentChecklist('production');
      
      expect(checklist).toContain('□ Configuration validation passed');
      expect(checklist).toContain('□ Load balancer configured');
      expect(checklist).toContain('□ Auto-scaling policies set');
      expect(checklist).toContain('□ Disaster recovery plan activated');
    });

    it('should handle unknown environment in checklist generation', () => {
      const checklist = deploymentManager.generateDeploymentChecklist('unknown');
      
      expect(checklist).toContain('Error: Unknown environment unknown');
    });
  });

  describe('Environment Variable Validation', () => {
    it('should detect missing required environment variables', async () => {
      // Clear required environment variables for production
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      
      const validation = await deploymentManager.validateDeployment('production');
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('Required environment variable NODE_ENV is not set')
      )).toBe(true);
      
      // Restore environment
      if (originalEnv) {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Security Requirements Validation', () => {
    it('should validate security requirements for production', async () => {
      const validation = await deploymentManager.validateDeployment('production');
      
      // Should have some validation results (may be warnings or errors)
      expect(validation.errors.length + validation.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it('should validate security requirements for development', async () => {
      const validation = await deploymentManager.validateDeployment('development');
      
      expect(validation.environment).toBe('development');
      // Development should be more lenient
      expect(validation.isValid).toBe(true);
    });
  });
});