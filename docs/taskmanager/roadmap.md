# Road Map

# Server

- ### @: root folder/server.ts
- Starting point of Server with HTTP, HTTPs , sftp
- 
- ### @: root folder/cortex/main.ts
- Collects all App from root/Apps and find app.ts and register all apps as ^registerApps  


# Database

# Http

# Logger

# App Register

# Route Register

# Cli

# Helpers

# Settings

# Tests

# Utils

# Env

# Routes

# Tenant

1. File Responsibilities & Connections
2. tenant.model.ts → Defines the schema/entity (e.g., Mongoose/TypeORM/Sequelize model).
3. tenant.repo.ts → Handles persistence (CRUD DB ops using the model).
4. tenant.service.ts → Business logic, orchestrates repo calls and validations.
5. tenant.validator.ts → Input validation (DTOs, Joi/Zod, class-validator).
6. tenant.controller.ts → HTTP entrypoint, calls service, applies validators. 
7. tenant.routes.ts → Express/Nest routing, wiring controller endpoints.
8. tenant.e2.test.ts → Black-box testing via HTTP calls to the tenant.routes.ts.
