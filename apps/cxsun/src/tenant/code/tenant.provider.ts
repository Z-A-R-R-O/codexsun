// apps/cxsun/tenant/src/tenant/code/tenant.provider.ts
import { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { App } from "../../../../../cortex/framework/application"; // Import types from application.ts

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        const routesDir = path.join(__dirname, "routes");
        if (!existsSync(routesDir)) {
            this.app.getLogger().warn("No routes directory found", {
                context: "tenant-provider",
                app: "tenant",
            });
            return;
        }

        const entries = readdirSync(routesDir, { withFileTypes: true }).filter(
            (d) => d.isFile() && d.name.includes("tenant.routes") && (d.name.endsWith(".ts") || d.name.endsWith(".js"))
        );

        for (const entry of entries) {
            const routePath = path.join(routesDir, entry.name);
            const providerName = path.basename(entry.name, path.extname(entry.name));
            try {
                const mod = await import(pathToFileURL(routePath).href);
                await this.app.registerRouteModule(mod.default); // Use new method
                this.app.getLogger().info(`Route module registered: ${providerName}`, {
                    context: "tenant-provider",
                    app: "tenant",
                    provider: providerName,
                });
            } catch (err) {
                this.app.getLogger().error(`Failed to load route provider: ${providerName}`, {
                    error: String(err),
                    context: "tenant-provider",
                    app: "tenant",
                    provider: providerName,
                });
            }
        }
    }
}