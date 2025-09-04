// tenant.service.ts — simplified, no transactions
import { Tenant } from "./tenant.model";
import { AuditService } from "../../../../cortex/core/audit/audit.service";

export class TenantService {
    static async createTenant(data: Partial<Tenant>, userId?: string): Promise<Tenant> {
        const tenant = await Tenant.create(data);
        await AuditService.log("create", Tenant.table, tenant.id!, data, userId);
        return tenant;
    }

    static async getTenant(id: string): Promise<Tenant | null> {
        return await Tenant.find(id);
    }

    static async updateTenant(id: string, updates: Partial<Tenant>, userId?: string): Promise<Tenant | null> {
        const tenant = await Tenant.find(id);
        if (!tenant) return null;

        Object.assign(tenant, updates);
        await tenant.save();
        await AuditService.log("update", Tenant.table, tenant.id!, updates, userId);
        return tenant;
    }

    static async deleteTenant(id: string, userId?: string): Promise<boolean> {
        const tenant = await Tenant.find(id);
        if (!tenant) return false;

        await tenant.delete();
        await AuditService.log("delete", Tenant.table, id, null, userId);
        return true;
    }

    static async listTenants(): Promise<Tenant[]> {
        return await Tenant.all();
    }
}
