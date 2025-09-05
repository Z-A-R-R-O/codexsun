// cortex/main.ts
import { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { RouteRegistry } from "./framework/route-registry";
import { DIContainer } from "./framework/di";
import { App } from "./framework/application";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export async function registerApps(diContainer: DIContainer) {
    const routeRegistry = new RouteRegistry();
    diContainer.register("routeRegistry", { type: "singleton", value: routeRegistry });
    const app = new App(diContainer, routeRegistry);

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
                diContainer.resolve("logger").warn(`⚠️ Skipping ${entry.name}: no app.ts found`, {
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
                    diContainer.resolve("logger").info(`✅ Registered app: ${entry.name}`, {
                        context: "app-loader",
                        app: entry.name,
                    });
                } else {
                    diContainer.resolve("logger").warn(`⚠️ ${entry.name} has no valid registerApp`, {
                        context: "app-loader",
                        app: entry.name,
                    });
                }
            } catch (err) {
                diContainer.resolve("logger").error(`⚠️ Failed to load app ${entry.name}`, {
                    error: String(err),
                    context: "app-loader",
                    app: entry.name,
                });
            }
        }
    }

    if (!registered) {
        diContainer.resolve("logger").warn(
            "ℹ️ No apps registered. Set APPS_DIR to your apps root.",
            { context: "app-loader" }
        );
    }
}