// apps/cxsun/app.ts
import { App } from "../../cortex/framework/application";
import { TenantProvider } from "./src/tenant/code/tenant.provider";

export async function registerApp(app: App): Promise<void> {
    try {
        const tenantProvider = new TenantProvider(app);
        await tenantProvider.register();
        app.getLogger().info("Cxsun app fully registered", {
            context: "app-loader",
            app: "cxsun",
        });
    } catch (err) {
        app.getLogger().error(`Failed to register cxsun app: ${String(err)}`, {
            context: "app-loader",
            app: "cxsun",
            error: String(err),
        });
        throw err; // Propagate error to prevent partial setup
    }
}