# Configuration Management

This directory contains configuration management files for the Gold Router App.

## Files

- `app.example.json` - Example application configuration file
- `deployment.example.env` - Example environment variables for deployment
- `README.md` - This documentation file

## Configuration System

The Gold Router App uses a layered configuration system that supports:

1. **Default Configuration** - Built-in defaults in `ConfigurationManager`
2. **File-based Configuration** - JSON configuration files
3. **Environment Variables** - Runtime environment overrides
4. **Environment-specific Overrides** - Development, staging, production settings

### Configuration Priority

Configuration values are applied in the following order (later values override earlier ones):

1. Default configuration (hardcoded)
2. Configuration file (`app.json`)
3. Environment variables
4. Environment-specific overrides

### Environment Variables

The following environment variables are supported:

#### Required for Production
- `NODE_ENV` - Environment (development, staging, production)
- `DB_HOST` - Database host
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password
- `MASTER_KEY` - Master encryption key

#### Optional
- `PORT` - Application port (default: 3000)
- `HOST` - Application host (default: localhost)
- `LOG_LEVEL` - Logging level (debug, info, warn, error)
- `DB_PORT` - Database port (default: 5432)
- `DB_NAME` - Database name (default: gold_router)

### Configuration Sections

#### Database Configuration
- Connection settings for PostgreSQL database
- SSL configuration and connection pooling
- Timeout and retry settings

#### Security Configuration
- Encryption algorithms and key lengths
- Session management settings
- Authentication and authorization controls

#### Trading Configuration
- Slippage protection settings
- Order timeout and retry configuration
- Risk management parameters

#### Monitoring Configuration
- Health check intervals
- Alert thresholds for system metrics
- Logging and metrics retention

#### Exchange Configuration
- API endpoints and rate limits
- Connection timeouts and retry logic
- Exchange-specific settings

#### Blockchain Configuration
- RPC endpoints for blockchain networks
- Confirmation thresholds
- Gas limits and network settings

## Usage

### Development Setup

1. Copy the example configuration:
   ```bash
   cp config/app.example.json config/app.json
   cp config/deployment.example.env .env
   ```

2. Update the configuration files with your settings

3. The application will automatically load and validate the configuration on startup

### Production Deployment

1. Set required environment variables:
   ```bash
   export NODE_ENV=production
   export DB_HOST=your-production-db-host
   export DB_USER=your-db-user
   export DB_PASSWORD=your-secure-password
   export MASTER_KEY=your-master-encryption-key
   ```

2. Use the DeploymentManager to validate deployment readiness:
   ```typescript
   const deploymentManager = new DeploymentManager(configService, securityManager);
   const validation = await deploymentManager.validateDeployment('production');
   
   if (!validation.isValid) {
     console.error('Deployment validation failed:', validation.errors);
     process.exit(1);
   }
   ```

### Configuration Validation

The system automatically validates all configuration values:

- **Type checking** - Ensures values are correct types
- **Range validation** - Checks numeric values are within valid ranges
- **Required fields** - Verifies all required configuration is present
- **Security validation** - Ensures security settings meet minimum requirements

### Secure Configuration Storage

Sensitive configuration data is automatically:

- **Encrypted at rest** using industry-standard algorithms
- **Classified and redacted** in logs and exports
- **Access controlled** with proper authentication
- **Audit logged** for security compliance

## Configuration API

### ConfigurationService

```typescript
// Initialize configuration
const configService = new ConfigurationService(auditService);
await configService.initialize();

// Get configuration sections
const dbConfig = configService.getDatabaseConfig();
const securityConfig = configService.getSecurityConfig();

// Update configuration
await configService.updateConfigSection('trading', {
  defaultSlippagePercent: 2.0
});

// Validate configuration
const validation = configService.validateConfiguration();
if (!validation.isValid) {
  console.error('Configuration errors:', validation.errors);
}
```

### DeploymentManager

```typescript
// Validate deployment
const validation = await deploymentManager.validateDeployment('production');

// Prepare deployment configuration
const deploymentConfig = await deploymentManager.prepareDeployment('production');

// Get deployment status
const status = await deploymentManager.getDeploymentStatus();

// Generate deployment checklist
const checklist = deploymentManager.generateDeploymentChecklist('production');
```

## Security Considerations

1. **Never commit sensitive configuration** to version control
2. **Use environment variables** for secrets in production
3. **Rotate encryption keys** regularly
4. **Monitor configuration changes** through audit logs
5. **Validate all configuration** before deployment
6. **Use least privilege** for database and API credentials

## Troubleshooting

### Configuration Validation Errors

If configuration validation fails:

1. Check the error messages for specific validation failures
2. Verify all required environment variables are set
3. Ensure numeric values are within valid ranges
4. Check that environment-specific requirements are met

### Environment Variable Issues

If environment variables are not being loaded:

1. Verify the variable names match exactly (case-sensitive)
2. Check that variables are exported in the shell
3. Ensure the application has permission to read environment variables
4. Verify the NODE_ENV value is valid (development, staging, production)

### Deployment Validation Failures

If deployment validation fails:

1. Review the validation errors and warnings
2. Check that all required environment variables are set for the target environment
3. Verify security requirements are met (SSL, encryption, etc.)
4. Ensure database connectivity and credentials are correct