# **Welcome to codexsun**

> **codexsun** is a multi-tenant SaaS platform built with TypeScript, and React .

---


# Server Entry Point (`index.ts`)

This file is the main starting point for the application server. It sets up environment variables, logging, database
initialization, HTTP/HTTPS servers, middleware, and routes.

## Responsibilities

- Loads environment variables using `dotenv/config`.
- Configures logging with file and console output via `createServerLogger`.
- Initializes the master database and core schema with `initDb`.
- Registers HTTP routes from modules (e.g., `welcome`, `health`) using `RouteRegistery`.
- Boots HTTP and optional HTTPS servers with middleware (session, tenant, db context) via `bootAll`.
- Handles process-level errors (`unhandledRejection`, `uncaughtException`) for robust error logging and hardening.

## Startup Flow

1. **Environment Setup**: Loads `.env` configuration.
2. **Logger Initialization**: Prepares a logger for console and file output.
3. **Route Registration**: Collects routes from providers.
4. **Database Initialization**: Ensures the master database is ready before serving requests.
5. **Server Boot**: Starts HTTP/HTTPS servers with registered routes and middleware.
6. **Error Handling**: Logs and exits on fatal startup errors.

> This project is designed for extensibility and high concurrency.  
> Contributions and feedback are encouraged.
> **Happy coding!**
>
---


## Key Imports

- `createServerLogger`: Logging utility.
- `initDb`: Master database initialization.
- `RouteRegistery`: Route collection and deduplication.

> **Note:**  
> Ensure your `.env` file is properly configured before starting the server.  
> For production deployments, review logging, security, and database settings.
