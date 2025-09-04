// apps/cxsun/src/tenant/code/tenant.model.ts

export type TenantID = string;

export interface Tenant {
  id: TenantID;
  name: string;
  email?: string;
  status?: "active" | "inactive";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}
