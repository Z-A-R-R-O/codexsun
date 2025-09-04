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

  override async create(_req: HttpRequest) {
    const meta = this.svc.meta();
    return { ok: true, schema: meta.schema, defaults: meta.defaults };
  }

  override async edit(req: HttpRequest) {
    const id = req.params?.id;
    if (!id) return { ok: false, error: "BAD_REQUEST", message: "id is required" };
    const item = await this.svc.get(id);
    if (!item) return { ok: false, error: "NOT_FOUND" };
    return { ok: true, item };
  }

  override async update(req: HttpRequest) {
    const id = req.params?.id;
    if (!id) return { ok: false, error: "BAD_REQUEST", message: "id is required" };
    return this.svc.update(id, req.body);
  }

  override async store(req: HttpRequest) {
    return this.svc.create(req.body);
  }

  override async delete(req: HttpRequest) {
    const id = req.params?.id;
    if (!id) return { ok: false, error: "BAD_REQUEST", message: "id is required" };
    return this.svc.remove(id);
  }

  override async print(req: HttpRequest) {
    const id = req.params?.id;
    if (!id) return { ok: false, error: "BAD_REQUEST", message: "id is required" };
    const item = await this.svc.get(id);
    if (!item) return { ok: false, error: "NOT_FOUND" };
    return { printable: true, format: "pdf-ready", data: item };
  }

  override async upload(req: HttpRequest) {
    return this.svc.handleUpload(req.files, req.params);
  }

  override async download(req: HttpRequest) {
    const id = req.params?.id;
    if (!id) return { ok: false, error: "BAD_REQUEST", message: "id is required" };
    const file = await this.svc.getExport(id);
    return { download: true, filename: file.name, mime: file.mime, stream: file.stream };
  }
}
