
// apps/cxsun/src/tenant/code/tenant.types.ts
export type Tenant = {
    id: string;
    name: string;
    slug: string;
    meta?: Record<string, any>;
    createdAt: number; // epoch ms
    updatedAt: number; // epoch ms
    deletedAt?: number | null;
    version: number;   // increments on every update
};

export type ListOptions = {
    sort?: 'createdAt' | 'name';
    order?: 'asc' | 'desc';
    includeDeleted?: boolean;
    cursor?: string; // base64
};

