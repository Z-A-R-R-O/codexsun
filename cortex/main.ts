// main.ts — registers app modules onto our RouteRegistry
import { readdirSync } from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { RouteRegistry } from "./http/route_registry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Discover apps under ./apps/* and call their exported registerApp(registry)
 */
export async function registerApps(registry: RouteRegistry) {
    const appsDir = path.resolve(__dirname, "./apps");
    const apps = readdirSync(appsDir, { withFileTypes: true })
        .filter((dir) => dir.isDirectory())
        .map((dir) => dir.name);

    for (const appName of apps) {
        const appPath = path.resolve(appsDir, appName, "app.ts");
        try {
            const mod = await import(pathToFileURL(appPath).href);
            const registerApp = mod.registerApp || mod.default?.registerApp;
            if (typeof registerApp === "function") {
                await registerApp(registry);
                console.log(`✅ Registered app: ${appName}`);
            } else {
                console.warn(`⚠️ ${appName} has no registerApp(registry)`);
            }
        } catch (err) {
            console.error(`⚠️ Could not load app ${appName}`, err);
        }
    }
}
