// apps/cxsun/src/tenant/code/tenant.repo.ts

import type { Tenant, TenantID } from "./tenant.model";

export interface ListOptions {
  cursor?: string;
  limit: number;
}

export interface ListResult<T> {
  ok: true;
  count: number;
  items: T[];
  nextCursor?: string;
}

export interface TenantRepo {
  list(opts: ListOptions): Promise<ListResult<Tenant>>;
  get(id: TenantID): Promise<Tenant | null>;
  create(data: Omit<Tenant, "id" | "createdAt" | "updatedAt">): Promise<Tenant>;
  update(id: TenantID, data: Partial<Omit<Tenant, "id" | "createdAt" | "updatedAt">>): Promise<Tenant | null>;
  remove(id: TenantID): Promise<boolean>;
}

export class InMemoryTenantRepo implements TenantRepo {
  private store: Map<TenantID, Tenant> = new Map();

  async list(opts: ListOptions): Promise<ListResult<Tenant>> {
    const all = Array.from(this.store.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = opts.cursor ? Math.max(0, all.findIndex(t => t.id === opts.cursor) + 1) : 0;
    const items = all.slice(start, start + opts.limit);
    const nextCursor = (start + opts.limit) < all.length ? items[items.length - 1]?.id : undefined;
    return { ok: true, count: items.length, items, nextCursor };
  }

  async get(id: TenantID): Promise<Tenant | null> {
    return this.store.get(id) ?? null;
  }

  async create(data: Omit<Tenant, "id" | "createdAt" | "updatedAt">): Promise<Tenant> {
    const now = new Date().toISOString();
    const id = Math.random().toString(36).slice(2, 10);
    const t: Tenant = { id, createdAt: now, updatedAt: now, ...data };
    this.store.set(id, t);
    return t;
  }

  async update(id: TenantID, data: Partial<Omit<Tenant, "id" | "createdAt" | "updatedAt">>): Promise<Tenant | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated: Tenant = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.store.set(id, updated);
    return updated;
    }

  async remove(id: TenantID): Promise<boolean> {
    return this.store.delete(id);
  }
}
