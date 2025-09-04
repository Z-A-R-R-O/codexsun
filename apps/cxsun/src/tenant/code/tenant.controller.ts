// apps/cxsun/src/tenant/code/tenant.controller.ts
import type { HttpRequest } from "../../../../../cortex/http/types";
import { AbstractController } from "../../../../../cortex/http/controller/base.controller";
import { TenantService } from "./tenant.service";

export class TenantController extends AbstractController {
    private svc: TenantService;

    constructor(namespace = "default") {
        super();
        this.svc = new TenantService(namespace);
    }

    override async index(req: HttpRequest) {
        const cursor = Array.isArray(req.query?.cursor) ? req.query?.cursor[0] : req.query?.cursor;
        const limit = Number(req.query?.limit) || 20;

        return this.svc.list({ cursor, limit });
    }


    async create(_req: HttpRequest) {
        // return defaults/metadata to create a tenant (like Laravel create)
        return { ok: true, schema: this.svc.meta().schema, defaults: this.svc.meta().defaults };
    }

    async edit(req: HttpRequest) {
        const id = req.params?.id!;
        return this.svc.get(id);
    }

    async update(req: HttpRequest) {
        const id = req.params?.id!;
        return this.svc.update(id, req.body);
    }

    async store(req: HttpRequest) {
        return this.svc.create(req.body);
    }

    async delete(req: HttpRequest) {
        const id = req.params?.id!;
        return this.svc.remove(id);
    }

    async print(req: HttpRequest) {
        // could return printable payload; adapter decides headers/content-type
        const id = req.params?.id!;
        const data = await this.svc.get(id);
        return { printable: true, format: "pdf-ready", data };
    }

    async upload(req: HttpRequest) {
        // expects req.files (adapter-populated)
        return this.svc.handleUpload(req.files, req.params);
    }

    async download(req: HttpRequest) {
        // return a descriptor your adapter can turn into a stream/attachment
        const id = req.params?.id!;
        const file = await this.svc.getExport(id);
        return { download: true, filename: file.name, mime: file.mime, stream: file.stream };
    }
}
