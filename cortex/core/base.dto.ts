// base.dto.ts — DTO validation for Models
import { getSchema } from "./decorators";

export class ValidationError extends Error {
    constructor(public errors: Record<string, string[]>) {
        super("Validation failed");
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/* ──────────────────────────────
 * validateDto(schema, data)
 * ────────────────────────────── */
export async function validateDto(schema: Record<string, any>, data: any): Promise<void> {
    const errors: Record<string, string[]> = {};

    for (const [field, options] of Object.entries(schema)) {
        const value = data[field];

        // Required / nullable check
        if (!options.nullable && (value === null || value === undefined)) {
            errors[field] = errors[field] || [];
            errors[field].push("Field is required");
            continue;
        }

        // Type check (if type provided in decorator)
        if (value !== null && value !== undefined && options.type) {
            if (options.type === "string" && typeof value !== "string") {
                (errors[field] ||= []).push("Must be a string");
            }
            if (options.type === "number" && typeof value !== "number") {
                (errors[field] ||= []).push("Must be a number");
            }
            if (options.type === "boolean" && typeof value !== "boolean") {
                (errors[field] ||= []).push("Must be a boolean");
            }
        }
    }

    if (Object.keys(errors).length > 0) {
        throw new ValidationError(errors);
    }
}

/* ──────────────────────────────
 * BaseDTO
 * ────────────────────────────── */
export abstract class BaseDTO {
    constructor(data: any) {
        Object.assign(this, data);
    }

    async validate(): Promise<void> {
        const schema = getSchema(this.constructor);
        await validateDto(schema, this);
    }
}
