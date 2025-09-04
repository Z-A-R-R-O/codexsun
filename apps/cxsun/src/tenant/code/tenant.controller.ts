// apps/cxsun/src/tenant/code/tenant.controller.ts
import { ok, serverError } from "../../../../../cortex/http/respond";
import { TenantService } from "./tenant.service";

// Make index an arrow method so `this` stays bound when passed to router.
export class TenantController {
    private svc: TenantService;

    constructor(namespace = "default") {
        this.svc = new TenantService(namespace);
    }
// arrow keeps `this` bound for router
    index = async (req: any, res: any) => {
        try {
            await this.svc.init();

            const q = (req?.query ?? {}) as { cursor?: string; limit?: string | number };

            const opts = {
                cursor: typeof q.cursor === "string" ? q.cursor : undefined,
                limit:
                    typeof q.limit === "string"
                        ? Number.isFinite(Number(q.limit)) ? Number(q.limit) : undefined
                        : typeof q.limit === "number"
                            ? q.limit
                            : undefined,
            };

            // match signature: (filter, opts)
            const result = await this.svc.list({}, opts);

            const items = result.items ?? [];
            const total = result.total;

            return ok(res, {
                ok: true,
                count: total,
                items,
                nextCursor: result.nextCursor,
            });
        } catch (e: any) {
            return serverError(res, e?.message || "Failed to list tenants");
        }
    };
}