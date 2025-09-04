// apps/cxsun/src/tenant/code/tenant.service.ts
export class TenantService {
    private namespace: string;

    constructor(namespace: string) {
        this.namespace = namespace;
    }

    async init() {
        // any setup
    }

    list(opts: { cursor?: string; limit: number }) {
        return { ok: true, count: 0, items: [], nextCursor: undefined };
    }

    get(id: string) {
        return { id, name: "Tenant " + id };
    }

    create(data: any) {
        return { id: "new", ...data };
    }

    update(id: string, data: any) {
        return { id, ...data };
    }

    remove(id: string) {
        return { ok: true, removed: id };
    }

    // 👇 add this so controller’s create() works
    meta() {
        return {
            schema: { id: "string", name: "string" },
            defaults: { name: "" },
        };
    }

    handleUpload(files: any, params?: any) {
        return { ok: true, files, params };
    }

    getExport(id: string) {
        return {
            name: `tenant-${id}.json`,
            mime: "application/json",
            stream: Buffer.from(JSON.stringify({ id })),
        };
    }
}
