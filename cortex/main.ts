// cortex/main.ts
import { existsSync, readdirSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { RouteRegistry } from "./framework/route-registry";
import { Container } from "./framework/container"; // Use Container instead of DIContainer
import { App } from "./framework/application";
import type { Logger } from "./framework/types";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseList(v?: string): string[] {
    return v ? v.split(/[;,]/).map(s => s.trim()).filter(Boolean) : [];
}

function candidateDirs(): string[] {
    const fromEnv = parseList(process.env.APPS_DIR || process.env.APPS_DIRS);
    if (fromEnv.length) return fromEnv.map(p => path.resolve(process.cwd(), p));
    return [
        path.resolve(process.cwd(), "apps"),
        path.resolve(__dirname, "apps"),
    ];
}

export async function registerApps(container: Container): Promise<App> {
    // Register default logger if not present
    if (!container.services.has("logger")) {
        container.register("logger", {
            type: "singleton",
            factory: () => ({
                debug: (...args: unknown[]) => console.debug("[app]", ...args),
                info: (...args: unknown[]) => console.info("[app]", ...args),
                warn: (...args: unknown[]) => console.warn("[app]", ...args),
                error: (...args: unknown[]) => console.error("[app]", ...args),
                child: (scope: string) => ({
                    debug: (...args: unknown[]) => console.debug(`[app:${scope}]`, ...args),
                    info: (...args: unknown[]) => console.info(`[app:${scope}]`, ...args),
                    warn: (...args: unknown[]) => console.warn(`[app:${scope}]`, ...args),
                    error: (...args: unknown[]) => console.error(`[app:${scope}]`, ...args),
                }),
            }),
        });
    }

    const routeRegistry = new RouteRegistry(container);
    container.register("routeRegistry", { type: "singleton", value: routeRegistry });
    const app = new App(container, routeRegistry);

    const dirs = candidateDirs();
    let registered = 0;

    for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const entry of entries) {
            const appDir = path.join(dir, entry.name);
            const candidates = [
                path.join(appDir, "app.ts"),
                path.join(appDir, "app/index.ts"),
                path.join(appDir, "app.js"),
                path.join(appDir, "app/index.js"),
            ];
            const appPath = candidates.find(p => existsSync(p));
            if (!appPath) {
                container.resolve<Logger>("logger").warn(`⚠️ Skipping ${entry.name}: no app.ts found`, {
                    context: "app-loader",
                    app: entry.name,
                });
                continue;
            }

            try {
                const mod = await import(pathToFileURL(appPath).href);
                const fn = mod.registerApp ?? mod.default?.registerApp;
                if (typeof fn === "function") {
                    await fn(app);
                    registered++;
                    container.resolve<Logger>("logger").info(`✅ Registered app: ${entry.name}`, {
                        context: "app-loader",
                        app: entry.name,
                    });
                } else {
                    container.resolve<Logger>("logger").warn(`⚠️ ${entry.name} has no valid registerApp`, {
                        context: "app-loader",
                        app: entry.name,
                    });
                }
            } catch (err) {
                container.resolve<Logger>("logger").error(`⚠️ Failed to load app ${entry.name}`, {
                    error: String(err),
                    context: "app-loader",
                    app: entry.name,
                });
                throw err; // Propagate error to caller
            }
        }
    }

    if (!registered) {
        container.resolve<Logger>("logger").warn(
            "ℹ️ No apps registered. Set APPS_DIR to your apps root.",
            { context: "app-loader" }
        );
    }

    return app; // Return the App instance
}