// tenant.service.ts
// Minimal, portable Tenant service using your DB facade.
// - Creates `tenants` table on init (works on sqlite/mysql/pg)
// - CRUD with basic validation and unique `code` enforcement
// - Uses ? placeholders; your engine adapts per driver

import { randomUUID } from "crypto";
// Adjust this import if your connection lives elsewhere:
import type { Profile } from "../../../../../cortex/database/db";
import { Default } from "../../../../../cortex/database/connection";

export type TenantStatus = "active" | "inactive" | "suspended";

export interface Tenant {
    id: string;
    name: string;
    code: string;
    domain?: string | null;
    status: TenantStatus;
    plan_id?: string | null;
    metadata?: any;
    created_at: string;  // ISO
    updated_at: string;  // ISO
}

export interface CreateTenantInput {
    name: string;
    code: string;
    domain?: string | null;
    status?: TenantStatus;
    plan_id?: string | null;
    metadata?: any;
}

export interface UpdateTenantInput {
    name?: string;
    code?: string;               // changing code is allowed but still must be unique
    domain?: string | null;
    status?: TenantStatus;
    plan_id?: string | null;
    metadata?: any;
}

export class TenantService {
    constructor(private profile: Profile = "default") {}

    private async db() {
        // If your Default() accepts a profile, pass it here; if not, this still works.
        // return await Default(this.profile);
        return await Default();
    }

    /** Create table (id/code/name indexes, timestamps). Call once at startup. */
    async init(): Promise<void> {
        const db = await this.db();

        // Keep DDL portable across sqlite/mysql/pg by avoiding JSON/enum types.
        // Use VARCHAR + TEXT; store metadata as TEXT (JSON string).
        await db.Query(
            `
      CREATE TABLE IF NOT EXISTS tenants (
        id         VARCHAR(64)  PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        code       VARCHAR(64)  NOT NULL UNIQUE,
        domain     VARCHAR(255),
        status     VARCHAR(32)  NOT NULL DEFAULT 'active',
        plan_id    VARCHAR(64),
        metadata   TEXT,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      `
        );

        // Some engines may ignore UNIQUE in CREATE if it already exists; a separate index is harmless.
        await db.Query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_code ON tenants(code);`);
    }

    /** List with optional search (by name/code/domain). */
    async list(limit = 50, offset = 0, q?: string): Promise<Tenant[]> {
        const db = await this.db();
        const params: any[] = [];
        let where = "";
        if (q && q.trim()) {
            where = `WHERE (LOWER(name) LIKE LOWER(?) OR LOWER(code) LIKE LOWER(?) OR LOWER(COALESCE(domain,'')) LIKE LOWER(?))`;
            const like = `%${q.trim()}%`;
            params.push(like, like, like);
        }
        params.push(limit, offset);

        const rows = await db.FetchAll(
            `
      SELECT id, name, code, domain, status, plan_id, metadata, created_at, updated_at
      FROM tenants
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
            params
        );
        return rows.map(this.fromRow);
    }

    /** Get by id */
    async get(id: string): Promise<Tenant | null> {
        const db = await this.db();
        const row = await db.FetchOne(
            `SELECT id, name, code, domain, status, plan_id, metadata, created_at, updated_at
       FROM tenants WHERE id = ?`,
            [id]
        );
        return row ? this.fromRow(row) : null;
    }

    /** Create new tenant with unique code */
    async create(input: CreateTenantInput): Promise<Tenant> {
        this.validateCreate(input);

        // Enforce unique code
        const existing = await this.getByCode(input.code);
        if (existing) throw new Error(`Tenant code '${input.code}' already exists`);

        const db = await this.db();
        const id = randomUUID();
        const now = new Date().toISOString();

        await db.Query(
            `
      INSERT INTO tenants (id, name, code, domain, status, plan_id, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [
                id,
                input.name.trim(),
                input.code.trim(),
                orNull(input.domain),
                input.status ?? "active",
                orNull(input.plan_id),
                jsonOrNull(input.metadata),
                now,
                now,
            ]
        );

        const created = await this.get(id);
        if (!created) throw new Error("Failed to load created tenant");
        return created;
    }

    /** Update with patch; returns updated or null if not found */
    async update(id: string, patch: UpdateTenantInput): Promise<Tenant | null> {
        if (!id) throw new Error("id is required");
        this.validateUpdate(patch);

        // If patching code, check uniqueness against others
        if (patch.code) {
            const existing = await this.getByCode(patch.code);
            if (existing && existing.id !== id) {
                throw new Error(`Tenant code '${patch.code}' already exists`);
            }
        }

        const db = await this.db();

        // Build dynamic SET
        const sets: string[] = [];
        const args: any[] = [];

        if (patch.name !== undefined) { sets.push("name = ?"); args.push(patch.name?.trim() ?? null); }
        if (patch.code !== undefined) { sets.push("code = ?"); args.push(patch.code?.trim() ?? null); }
        if (patch.domain !== undefined) { sets.push("domain = ?"); args.push(orNull(patch.domain)); }
        if (patch.status !== undefined) { sets.push("status = ?"); args.push(patch.status); }
        if (patch.plan_id !== undefined) { sets.push("plan_id = ?"); args.push(orNull(patch.plan_id)); }
        if (patch.metadata !== undefined) { sets.push("metadata = ?"); args.push(jsonOrNull(patch.metadata)); }

        if (sets.length === 0) {
            // nothing to update; return current state
            return await this.get(id);
        }

        sets.push("updated_at = ?"); args.push(new Date().toISOString());
        args.push(id);

        const res = await db.Query(
            `UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`,
            args
        );

        const updated = await this.get(id);
        return updated; // may be null if id didn't exist
    }

    /** Delete by id; returns true if a row was deleted */
    async remove(id: string): Promise<boolean> {
        const db = await this.db();
        const res = await db.Query(`DELETE FROM tenants WHERE id = ?`, [id]);
        // Many drivers return affectedRows / rowCount. If not available, follow-up read:
        const still = await this.get(id);
        return !still;
    }

    // ---------- helpers ----------

    private async getByCode(code: string): Promise<Tenant | null> {
        const db = await this.db();
        const row = await db.FetchOne(
            `SELECT id, name, code, domain, status, plan_id, metadata, created_at, updated_at
       FROM tenants WHERE code = ?`,
            [code.trim()]
        );
        return row ? this.fromRow(row) : null;
    }

    private fromRow = (r: any): Tenant => {
        let meta: any = null;
        if (r.metadata !== null && r.metadata !== undefined) {
            if (typeof r.metadata === "string") {
                try { meta = JSON.parse(r.metadata); } catch { meta = r.metadata; }
            } else {
                meta = r.metadata;
            }
        }
        // Normalize timestamps to ISO strings if driver returns Date
        const created_at = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
        const updated_at = r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at);

        return {
            id: String(r.id),
            name: String(r.name),
            code: String(r.code),
            domain: r.domain == null ? null : String(r.domain),
            status: (r.status as TenantStatus) ?? "active",
            plan_id: r.plan_id == null ? null : String(r.plan_id),
            metadata: meta,
            created_at,
            updated_at,
        };
    };

    private validateCreate(input: CreateTenantInput) {
        if (!input || typeof input !== "object") throw new Error("Body required");
        if (!input.name || !String(input.name).trim()) throw new Error("name is required");
        if (!input.code || !String(input.code).trim()) throw new Error("code is required");
        if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(input.code))) throw new Error("code must be 2–64 chars [A-Za-z0-9_-]");
        if (input.status && !["active", "inactive", "suspended"].includes(input.status)) {
            throw new Error("invalid status");
        }
    }

    private validateUpdate(patch: UpdateTenantInput) {
        if (!patch || typeof patch !== "object") throw new Error("Body required");
        if (patch.code !== undefined && patch.code !== null) {
            if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(patch.code))) {
                throw new Error("code must be 2–64 chars [A-Za-z0-9_-]");
            }
        }
        if (patch.status && !["active", "inactive", "suspended"].includes(patch.status)) {
            throw new Error("invalid status");
        }
    }
}

// ---------- tiny helpers ----------

function orNull<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : (v as any);
}
function jsonOrNull(v: any): string | null {
    return v === undefined || v === null ? null : JSON.stringify(v);
}

export default TenantService;
