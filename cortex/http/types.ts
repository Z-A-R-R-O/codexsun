// cortex/http/types.ts

/**
 * Minimal framework-agnostic HttpRequest type.
 *
 * - Simple enough for portability across adapters (native http, express, etc.)
 * - Extensible via declaration merging if apps need custom fields.
 */
export interface HttpRequest {
    /** HTTP method (GET, POST, etc.) */
    method: string;

    /** Path of the incoming request */
    path: string;

    /** Route params (e.g., /users/:id -> { id: "123" }) */
    params?: Record<string, string>;

    /** Query string (?page=2&limit=10) */
    query?: Record<string, string | string[]>;

    /** Headers (normalized keys recommended by adapter) */
    headers?: Record<string, string>;

    /** Parsed body (JSON, form-data, etc.) */
    body?: unknown;

    /** Uploaded files (adapter decides structure, e.g., multer/BusBoy) */
    files?: unknown;

    /** Client IP if adapter provides it */
    ip?: string;

    /** Raw request object (optional, for edge cases) */
    raw?: unknown;
}
