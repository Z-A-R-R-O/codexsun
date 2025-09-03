// cortex/core/controller.ts
// Unified abstract controller with an embedded IRequest type.
// - Drop-in base for all controllers
// - Bundles a minimal IRequest interface and adapters
// - Middleware registry (use().only()/except())
// - Consistent envelopes + pagination helpers

// If you need framework-specific request features, extend IRequest below
// or pass them via the `raw` field.

export interface IRequest {
    /** URL params (e.g., { id: "123" }) */
    params: Record<string, any>;
    /** Query string object */
    query: Record<string, any>;
    /** Parsed JSON/body */
    body: any;
    /** Request headers */
    headers: Record<string, any>;
    /** Underlying server framework request (Fastify/Express/…) */
    raw?: any;
    /** App reference for middleware routers that need it */
    app?: any;
}

// Alias for convenience in app code
export type Request = IRequest;

export type HandlerName =
    | "Index"
    | "Show"
    | "Store"
    | "Update"
    | "Delete"
    | "Count"
    | "NextNo"
    | string;

export type MiddlewareSpec = {
    name: string;
    args?: any[];
};

export type MiddlewareMap = Record<HandlerName, MiddlewareSpec[]>;

export interface SuccessEnvelope<T = unknown> {
    status: "success";
    data: T;
    meta?: Record<string, any>;
}

export interface ErrorEnvelope {
    status: "error";
    message: string;
    code?: number;
    details?: any;
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export interface PaginationMeta {
    limit: number;
    offset: number;
    sort?: string;
    order?: "asc" | "desc";
}

export interface ControllerOptions {
    basePath?: string;
    wrapResponses?: boolean; // default true -> return { status, data }
    exposeErrors?: boolean;  // include error stack/details in non-prod
}

class MiddlewareBuilder {
    private registry: MiddlewareMap;
    private spec: MiddlewareSpec;

    constructor(registry: MiddlewareMap, spec: MiddlewareSpec) {
        this.registry = registry;
        this.spec = spec;
    }

    /** Attach to only specific handlers */
    only(names: HandlerName[]) {
        names.forEach((n) => {
            if (!this.registry[n]) this.registry[n] = [];
            this.registry[n].push(this.spec);
        });
        return this;
    }

    /** Attach to all except the listed handlers */
    except(names: HandlerName[]) {
        const exceptSet = new Set(names);
        const all: HandlerName[] = [
            "Index",
            "Show",
            "Store",
            "Update",
            "Delete",
            "Count",
            "NextNo",
        ];
        all.forEach((n) => {
            if (!exceptSet.has(n)) {
                if (!this.registry[n]) this.registry[n] = [];
                this.registry[n].push(this.spec);
            }
        });
        return this;
    }
}

/**
 * Controller (abstract)
 *
 * Subclasses implement protected *Impl methods (e.g., indexImpl) with business logic.
 * The base exposes public handlers (Index/Show/Store/Update/Delete/Count/NextNo)
 * that wrap execution with middleware + error handling.
 */
export abstract class Controller<Svc = any> {
    protected service: Svc;
    protected options: Required<ControllerOptions>;
    protected basePath: string;
    private middlewares: MiddlewareMap = {};

    constructor(service: Svc, basePath: string = "/", options?: ControllerOptions) {
        this.service = service;
        this.basePath = basePath;
        this.options = {
            basePath,
            wrapResponses: true,
            exposeErrors: process.env.NODE_ENV !== "production",
            ...(options || {}),
        } as Required<ControllerOptions>;
    }

    /** Register middleware and build attach-rules */
    use(name: string, ...args: any[]) {
        return new MiddlewareBuilder(this.middlewares, { name, args });
    }

    /** Return route metadata for router integration (optional) */
    getRouteConfig() {
        return {
            basePath: this.basePath,
            middlewares: this.middlewares,
        };
    }

    // ------------------ Public handlers (wrap + delegate) ------------------
    Index  = (req: Request) => this._wrap("Index",  req, () => this.indexImpl(req));
    Show   = (req: Request) => this._wrap("Show",   req, () => this.showImpl(req));
    Store  = (req: Request) => this._wrap("Store",  req, () => this.storeImpl(req));
    Update = (req: Request) => this._wrap("Update", req, () => this.updateImpl(req));
    Delete = (req: Request) => this._wrap("Delete", req, () => this.deleteImpl(req));
    Count  = (req: Request) => this._wrap("Count",  req, () => this.countImpl(req));
    NextNo = (req: Request) => this._wrap("NextNo", req, () => this.nextNoImpl(req));

    // ------------------ Methods to implement in subclass ------------------
    protected abstract indexImpl(req: Request): Promise<any>;
    protected abstract showImpl(req: Request): Promise<any>;
    protected abstract storeImpl(req: Request): Promise<any>;
    protected abstract updateImpl(req: Request): Promise<any>;
    protected abstract deleteImpl(req: Request): Promise<any>;
    protected countImpl(req: Request): Promise<any> {
        return Promise.resolve({ count: 0 }); // optional override
    }
    protected nextNoImpl(req: Request): Promise<any> {
        return Promise.resolve({ next: 1 }); // optional override
    }

    // ------------------ Core wrapper ------------------
    private async _wrap(
        name: HandlerName,
        req: Request,
        run: () => Promise<any>
    ): Promise<Envelope> {
        try {
            // Execute middleware hooks (no-ops by default).
            await this._runMiddlewares(name, req);

            const result = await run();
            return this.options.wrapResponses
                ? this.ok(result, this._maybeMeta(req))
                : (result as Envelope);
        } catch (err: any) {
            return this.fail(err);
        }
    }

    private async _runMiddlewares(name: HandlerName, req: Request) {
        const list = this.middlewares[name] || [];
        for (const mw of list) {
            // Delegate to framework-level middleware runner if available
            if (typeof (req as any).runMiddleware === "function") {
                await (req as any).runMiddleware(mw.name, ...(mw.args || []));
            } else if (typeof (req as any).app?.runMiddleware === "function") {
                await (req as any).app.runMiddleware(mw.name, req, ...(mw.args || []));
            }
        }
    }

    // ------------------ Helpers ------------------
    protected ok<T = unknown>(data: T, meta?: Record<string, any>): SuccessEnvelope<T> {
        return { status: "success", data, ...(meta ? { meta } : {}) };
    }

    protected fail(error: any, code = 400): ErrorEnvelope {
        const message = error?.message || String(error);
        const base: ErrorEnvelope = { status: "error", message, code };
        if (this.options.exposeErrors) {
            return { ...base, details: { stack: error?.stack, name: error?.name } };
        }
        return base;
    }

    protected requireId(req: Request, key = "id"): number {
        const raw = (req.params?.[key] ?? req.query?.[key]) as any;
        const id = Number(raw);
        if (!Number.isFinite(id)) throw new Error(`Invalid or missing ${key}`);
        return id;
    }

    protected getPagination(req: Request): PaginationMeta {
        const limit = Math.min(1000, Math.max(1, Number(req.query?.limit ?? 100)));
        const offset = Math.max(0, Number(req.query?.offset ?? 0));
        const sort = (req.query?.sort as string) || "id";
        const order =
            ((req.query?.order as string) || "asc").toLowerCase() === "desc"
                ? "desc"
                : "asc";
        return { limit, offset, sort, order };
    }

    protected _maybeMeta(req: Request): PaginationMeta | undefined {
        const q = req?.query || {};
        if (q.limit != null || q.offset != null || q.sort != null || q.order != null) {
            return this.getPagination(req);
        }
        return undefined;
    }
}

// ------------------ Request Adapters ------------------
// These helpers create our minimal IRequest from specific frameworks.
export const aRequest = {
    fromFastify(req: any): IRequest {
        return {
            params: req.params || {},
            query: req.query || {},
            body: req.body,
            headers: req.headers || {},
            raw: req,
            app: req.server || req.app,
        };
    },
    // fromExpress(req: any): IRequest {
    //     return {
    //         params: req.params || {},
    //         query: req.query || {},
    //         body: req.body,
    //         headers: req.headers || {},
    //         raw: req,
    //         app: req.app,
    //     };
    // },
};
