// apps/cxsun/src/tenant/code/tenant.validator.ts

import type { Tenant } from "./tenant.model";

export type ValidationResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export const TenantValidator = {
  create(input: any): ValidationResult<Omit<Tenant, "id" | "createdAt" | "updatedAt">> {
    if (!isNonEmptyString(input?.name)) {
      return { ok: false, error: "name is required" };
    }
    if (input.email && typeof input.email !== "string") {
      return { ok: false, error: "email must be a string" };
    }
    const status = input.status ?? "active";
    if (status !== "active" && status !== "inactive") {
      return { ok: false, error: "status must be 'active' or 'inactive'" };
    }
    return {
      ok: true,
      value: {
        name: String(input.name).trim(),
        email: input.email ? String(input.email).trim() : undefined,
        status,
      },
    };
  },

  update(input: any): ValidationResult<Partial<Omit<Tenant, "id" | "createdAt" | "updatedAt">>> {
    const out: any = {};
    if (input.name !== undefined) {
      if (!isNonEmptyString(input.name)) return { ok: false, error: "name must be non-empty string" };
      out.name = String(input.name).trim();
    }
    if (input.email !== undefined) {
      if (typeof input.email !== "string") return { ok: false, error: "email must be a string" };
      out.email = String(input.email).trim();
    }
    if (input.status !== undefined) {
      if (input.status !== "active" && input.status !== "inactive") {
        return { ok: false, error: "status must be 'active' or 'inactive'" };
      }
      out.status = input.status;
    }
    return { ok: true, value: out };
  },
};
