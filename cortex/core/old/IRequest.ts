// cortex/framework/request.ts
import type { FastifyRequest } from "fastify";

export class IRequest {
    private readonly raw: FastifyRequest;

    constructor(raw: FastifyRequest) {
        this.raw = raw;
    }

    // Access query params safely
    get query() {
        return this.raw.query as Record<string, any>;
    }

    // Access path params safely
    get params() {
        return this.raw.params as Record<string, any>;
    }

    // Access request body
    get body() {
        return this.raw.body as any;
    }

    // Access headers
    get headers() {
        return this.raw.headers as Record<string, any>;
    }

    // Generic getter if needed
    getRaw<T extends FastifyRequest>() {
        return this.raw as T;
    }
}
