// apps/cxsun/src/user/code/user.validator.ts
import { z } from "zod";
import type { FastifyRequest } from "fastify";

// --- Schemas ---
const CreateUserSchema = z.object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().min(6),
    is_active: z.coerce.boolean().default(true),
});

const UpdateUserSchema = z.object({
    id: z.number(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    is_active: z.coerce.boolean().optional(),
});

const QueryUserSchema = z.object({
    limit: z.coerce.number().optional(),
    offset: z.coerce.number().optional(),
});

// --- Validators ---
export function validateCreate(req: FastifyRequest) {
    return CreateUserSchema.parse(req.body);
}

export function validateUpdate(req: FastifyRequest) {
    return UpdateUserSchema.parse(req.body);
}

export function validateQuery(req: FastifyRequest) {
    return QueryUserSchema.parse(req.query);
}
