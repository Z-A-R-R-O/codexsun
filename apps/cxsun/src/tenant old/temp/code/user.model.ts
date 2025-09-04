// apps/cxsun/src/user/code/user.model.ts

export type User = {
    id: number;
    name: string;
    email: string | null;
    password: string; // hashed
    tenant_id: number;
    meta: any | null; // JSONB/JSON/TEXT
    is_active: number; // 1/0
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
};


export type NewUser = {
    name: string;
    email: string | null;
    password: string; // plaintext on input; hashed in repo
    tenant_id: number;
    meta?: any | null;
    is_active?: number; // default 1
};


export type UpdateUser = Partial<Omit<NewUser, 'tenant_id'>> & { id: number };