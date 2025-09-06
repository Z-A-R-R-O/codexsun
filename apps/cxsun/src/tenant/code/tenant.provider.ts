// apps/cxsun/tenant/src/tenant/code/tenant.provider.ts

import { existsSync, readdirSync } from "fs";
import path from "path";
import {  pathToFileURL } from "url";
import { App } from "../../../../../cortex/framework/application";

import { fileURLToPath } from "url";
import { dirname } from "path";
import * as fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TenantProvider {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    async register() {
        try {
            await this.registerRouteProviders();
            this.app.getLogger().info("Tenant providers registered", {
                context: "tenant-provider",
                app: "tenant",
            });
        } catch (err) {
            this.app.getLogger().error(`Failed to register tenant providers: ${String(err)}`, {
                context: "tenant-provider",
                app: "tenant",
                error: String(err),
            });
            throw err;
        }
    }

    private async registerRouteProviders() {
        const logger = this.app.getLogger();

        // Step 1: Check for tenant.routes.ts or tenant.routes.js in the same directory
        const tenantRouteFiles = ["tenant.routes.ts", "tenant.routes.js"];
        let routeFileFound = false;

        for (const fileName of tenantRouteFiles) {
            const routePath = path.join(__dirname, fileName);
            if (fs.existsSync(routePath)) {
                try {
                    const mod = await import(pathToFileURL(routePath).href);
                    await this.app.registerRouteModule(mod.default);
                    logger.info(`Route module registered: ${fileName}`, {
                        context: "tenant-provider",
                        app: "tenant",
                        provider: fileName,
                    });
                    routeFileFound = true;
                } catch (err) {
                    logger.error(`Failed to load route provider: ${fileName}`, {
                        error: String(err),
                        context: "tenant-provider",
                        app: "tenant",
                        provider: fileName,
                    });
                }
            }
        }

        // Step 2: Fallback to checking routes directory if no tenant.routes file found
        if (!routeFileFound) {
            const routesDir = path.join(__dirname, "routes");
            if (!fs.existsSync(routesDir)) {
                logger.warn(`No routes directory found at ${routesDir}`, {
                    context: "tenant-provider",
                    app: "tenant",
                });
                return;
            }

            const entries = fs.readdirSync(routesDir, { withFileTypes: true }).filter(
                (d) => d.isFile() && d.name.includes("tenant.routes") && (d.name.endsWith(".ts") || d.name.endsWith(".js"))
            );

            for (const entry of entries) {
                const routePath = path.join(routesDir, entry.name);
                const providerName = path.basename(entry.name, path.extname(entry.name));
                try {
                    const mod = await import(pathToFileURL(routePath).href);
                    await this.app.registerRouteModule(mod.default);
                    logger.info(`Route module registered: ${providerName}`, {
                        context: "tenant-provider",
                        app: "tenant",
                        provider: providerName,
                    });
                } catch (err) {
                    logger.error(`Failed to load route provider: ${providerName}`, {
                        error: String(err),
                        context: "tenant-provider",
                        app: "tenant",
                        provider: providerName,
                    });
                }
            }
        }

        logger.info("Tenant providers registered", {
            context: "tenant-provider",
            app: "tenant",
        });
    }

}