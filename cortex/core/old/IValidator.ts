// cortex/core/IValidator.ts

// ---------- Branded primitives ----------
export type pkType = number;
export type strType = string;
export type emailType = string & { __emailBrand: true };
export type hashedType = string & { __hashedBrand: true };
export type boolType = boolean;
export type tzType = Date;

// (Internal aliases for local use)
type EmailString = emailType;
type HashedString = hashedType;

// ---------- Brand constructors (exported) ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Validate & brand an email string */
export function makeEmail(value: string): EmailString {
    if (!EMAIL_RE.test(value)) {
        throw new Error("Invalid email format");
    }
    return value as EmailString;
}

// Lightweight sync hash (replace with bcrypt/argon2 in production)
import { createHash, randomBytes } from "crypto";

/** Hash & brand a password string */
export function hashPassword(plain: string): HashedString {
    if (plain.length < 6) {
        throw new Error("Password must be at least 6 characters");
    }
    const salt = randomBytes(16).toString("hex");
    const digest = createHash("sha256").update(salt + plain).digest("hex");
    return `${salt}:${digest}` as HashedString;
}

// ---------- Base validator with all helpers ----------
export abstract class IValidator<TCreate, TUpdate = Partial<TCreate>> {
    // ----- string helpers -----
    protected requireString(label: string, v: unknown, minLen = 1): string {
        if (typeof v !== "string") throw new Error(`${label} is required and must be a string`);
        const s = v.trim();
        if (s.length < minLen) throw new Error(`${label} must be at least ${minLen} characters`);
        return s;
    }

    protected optionalString(label: string, v: unknown, minLen = 1): string | undefined {
        if (v === undefined || v === null) return undefined;
        return this.requireString(label, v, minLen);
    }

    // ----- number helpers -----
    protected requireNumber(
        label: string,
        v: unknown,
        opts?: { min?: number; max?: number; integer?: boolean }
    ): number {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new Error(`${label} is required and must be a number`);
        if (opts?.integer && !Number.isInteger(n)) throw new Error(`${label} must be an integer`);
        if (opts?.min !== undefined && n < opts.min) throw new Error(`${label} must be ≥ ${opts.min}`);
        if (opts?.max !== undefined && n > opts.max) throw new Error(`${label} must be ≤ ${opts.max}`);
        return n;
    }

    /** ✅ optionalNumber */
    protected optionalNumber(
        label: string,
        v: unknown,
        opts?: { min?: number; max?: number; integer?: boolean }
    ): number | undefined {
        if (v === undefined || v === null) return undefined;
        return this.requireNumber(label, v, opts);
    }

    // ----- boolean helpers -----
    protected requireBoolean(label: string, v: unknown): boolean {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (s === "true" || s === "1") return true;
            if (s === "false" || s === "0") return false;
        }
        if (typeof v === "number") {
            if (v === 1) return true;
            if (v === 0) return false;
        }
        throw new Error(`${label} is required and must be a boolean`);
    }

    /** ✅ optionalBoolean */
    protected optionalBoolean(label: string, v: unknown): boolean | undefined {
        if (v === undefined || v === null) return undefined;
        return this.requireBoolean(label, v);
    }

    // ----- array/object helpers -----
    protected requireArray<T>(
        label: string,
        v: unknown,
        map?: (el: unknown, idx: number) => T
    ): T[] {
        if (!Array.isArray(v)) throw new Error(`${label} is required and must be an array`);
        return map ? v.map(map) : (v as T[]);
    }

    /** ✅ optionalArray */
    protected optionalArray<T>(
        label: string,
        v: unknown,
        map?: (el: unknown, idx: number) => T
    ): T[] | undefined {
        if (v === undefined || v === null) return undefined;
        return this.requireArray(label, v, map);
    }

    protected requireObject<T extends object>(label: string, v: unknown): T {
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
            throw new Error(`${label} is required and must be an object`);
        }
        return v as T;
    }

    // ----- branded helpers (email / password) -----
    /** ✅ requireEmail */
    protected requireEmail(label: string, v: unknown): emailType {
        const s = this.requireString(label, v);
        return makeEmail(s);
    }

    protected optionalEmail(label: string, v: unknown): emailType | undefined {
        const s = this.optionalString(label, v);
        return s == null ? undefined : makeEmail(s);
    }

    protected optionalHashedPassword(label: string, v: unknown, minLen = 6): hashedType | undefined {
        const s = this.optionalString(label, v, minLen);
        return s == null ? undefined : hashPassword(s);
    }

    // ----- enums / unions -----
    protected orderLiteral(v: unknown, def: "asc" | "desc" = "asc"): "asc" | "desc" {
        const s = (typeof v === "string" ? v : String(v ?? "")).toLowerCase();
        return s === "desc" ? "desc" : s === "asc" ? "asc" : def;
    }

    // ----- abstract API -----
    abstract validateCreate(data: any): TCreate;
    abstract validateUpdate(data: any): TUpdate;
}
