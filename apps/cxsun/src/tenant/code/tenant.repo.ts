import { mdb } from "../../../../../cortex/database/db";
import type { Tenant } from "./tenant.model";

function nowIso() {
  return new Date().toISOString();
}

export class TenantRepository {
  async init() {
    // create table if not exists (engine-agnostic SQL; adjust types per engine as needed)
    await mdb.query(`CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    // lightweight index (no-op if exists)
    try { await mdb.query(`CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email)`); } catch {}
  }

  async create(data: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant> {
    const now = nowIso();
    const row: Tenant = { ...data, createdAt: now, updatedAt: now };
    await mdb.query(
      `INSERT INTO tenants (id, name, email, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.name, row.email, row.isActive ? 1 : 0, row.createdAt, row.updatedAt]
    );
    return row;
  }

  async get(id: string): Promise<Tenant | null> {
    const r = await mdb.fetchOne<any>(
      `SELECT id, name, email, is_active, created_at, updated_at FROM tenants WHERE id = ?`,
      [id]
    );
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      isActive: !!(r.is_active ?? r.isActive),
      createdAt: r.created_at ?? r.createdAt,
      updatedAt: r.updated_at ?? r.updatedAt,
    };
  }

  async list(limit = 50, offset = 0, q?: string): Promise<Tenant[]> {
    const params: any[] = [];
    let where = "";
    if (q && q.trim()) {
      where = `WHERE name LIKE ? OR email LIKE ?`;
      const like = `%${q.trim()}%`;
      params.push(like, like);
    }
    params.push(limit, offset);
    const rows = await mdb.fetchAll<any>(
      `SELECT id, name, email, is_active, created_at, updated_at
       FROM tenants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      isActive: !!(r.is_active ?? r.isActive),
      createdAt: r.created_at ?? r.createdAt,
      updatedAt: r.updated_at ?? r.updatedAt,
    }));
  }

  async update(id: string, patch: Partial<Pick<Tenant, "name" | "email" | "isActive">>): Promise<Tenant | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: Tenant = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    await mdb.query(
      `UPDATE tenants SET name = ?, email = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      [next.name, next.email, next.isActive ? 1 : 0, next.updatedAt, id]
    );
    return next;
  }

  async remove(id: string): Promise<boolean> {
    await mdb.query(`DELETE FROM tenants WHERE id = ?`, [id]);
    // If you need to know affected rows, extend mdb facade; otherwise assume true.
    return true;
  }
}
