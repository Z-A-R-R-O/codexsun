// apps/cxsun/src/tenant/code/tenant.service.ts
import type { ListOptions, ListResult, TenantRepo } from "./tenant.repo";
import { InMemoryTenantRepo } from "./tenant.repo";
import type { Tenant } from "./tenant.model";
import { TenantValidator } from "./tenant.validator";

export class TenantService {
  private namespace: string;
  private repo: TenantRepo;

  constructor(namespace: string) {
    this.namespace = namespace;
    // swap with real repo (e.g., SQL/Prisma) later
    this.repo = new InMemoryTenantRepo();
  }

  async init(): Promise<void> {
    // initialize connections if needed
  }

  list(opts: ListOptions): Promise<ListResult<Tenant>> {
    return this.repo.list(opts);
  }

  async get(id: string): Promise<Tenant | null> {
    return this.repo.get(id);
  }

  async create(data: any): Promise<{ ok: true; item: Tenant } | { ok: false; error: string }> {
    const v = TenantValidator.create(data);
    if (!v.ok) return { ok: false, error: v.error };
    const item = await this.repo.create(v.value);
    return { ok: true, item };
  }

  async update(id: string, data: any): Promise<{ ok: true; item: Tenant } | { ok: false; error: string }> {
    const v = TenantValidator.update(data);
    if (!v.ok) return { ok: false, error: v.error };
    const updated = await this.repo.update(id, v.value);
    if (!updated) return { ok: false, error: "not_found" };
    return { ok: true, item: updated };
  }

  async remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const removed = await this.repo.remove(id);
    return removed ? { ok: true } : { ok: false, error: "not_found" };
  }

  meta() {
    // could be generated from zod/joi later
    return {
      schema: {
        name: "string",
        email: "string?",
        status: "'active'|'inactive'?",
      },
      defaults: {
        status: "active",
      },
    };
  }

  async handleUpload(files: any, params?: any): Promise<{ ok: true; uploaded: number; params?: any }> {
    const uploaded = Array.isArray(files) ? files.length : (files ? 1 : 0);
    return { ok: true, uploaded, params };
  }

  async getExport(id: string) {
    const t = await this.repo.get(id);
    const name = `tenant-${id}.json`;
    const mime = "application/json";
    const stream = Buffer.from(JSON.stringify(t ?? { id, missing: true }, null, 2));
    return { name, mime, stream };
  }
}
