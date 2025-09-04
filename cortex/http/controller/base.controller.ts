// cortex/http/controller/base.controller.ts
import type { HttpRequest } from "../types";

/**
 * AbstractController
 * ------------------
 * Defines the standard REST-like contract for all resource controllers.
 *
 * - All methods are request-only.
 * - Concrete controllers must override each method.
 * - Return type is intentionally `unknown | Promise<unknown>` so each
 *   controller decides its own response shape (JSON, stream, etc.).
 */
export abstract class AbstractController {
    abstract index(req: HttpRequest): unknown | Promise<unknown>;
    abstract create(req: HttpRequest): unknown | Promise<unknown>;
    abstract edit(req: HttpRequest): unknown | Promise<unknown>;
    abstract update(req: HttpRequest): unknown | Promise<unknown>;
    abstract store(req: HttpRequest): unknown | Promise<unknown>;
    abstract delete(req: HttpRequest): unknown | Promise<unknown>;
    abstract print(req: HttpRequest): unknown | Promise<unknown>;
    abstract upload(req: HttpRequest): unknown | Promise<unknown>;
    abstract download(req: HttpRequest): unknown | Promise<unknown>;
}
