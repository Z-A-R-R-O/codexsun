// ===================================== app/user/User.schema.ts =====================================
import { z } from '../../../../../cortex/validation';


export const UserCreateSchema = z.object({
    name: z.string().min(1),
    email: z.string().email().optional().nullable(),
    password: z.string().min(6),
    tenant_id: z.number().int().positive(),
    meta: z.any().optional().nullable(),
    is_active: z.number().int().min(0).max(1).optional(),
});


export const UserUpdateSchema = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).optional(),
    email: z.string().email().optional().nullable(),
    password: z.string().min(6).optional(),
    meta: z.any().optional().nullable(),
    is_active: z.number().int().min(0).max(1).optional(),
});


export const UserQuerySchema = z.object({
    tenant_id: z.coerce.number().int().positive(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});