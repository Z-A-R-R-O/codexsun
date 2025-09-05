// apps/cxsun/app.ts
import { App } from "../../cortex/framework/application";
import { TenantProvider } from "./src/tenant/code/tenant.provider";

export async function registerApp(app: App) {
    const tenantProvider = new TenantProvider(app);
    await tenantProvider.register();
    app.getLogger().info("Cxsun app fully registered", {
        context: "app-loader",
        app: "cxsun",
    });
}