// cortex/tests/test_tenant_controller.ts
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import * as TenantRepoMod from "../code/tenant.repo";
import TenantController from "../code/tenant.controller";
import { logger } from "../../../../../cortex/log/logger";

// Minimal Response mock
function mockRes() {
    const res: Partial<Response> & {
        statusCode?: number;
        jsonData?: any;
        sent?: any;
    } = { statusCode: 200 }; // Express defaults to 200 if .status() isn't called

    // @ts-ignore
    res.status = (code: number) => {
        res.statusCode = code;
        return res as Response;
    };
    // @ts-ignore
    res.json = (data: any) => {
        res.jsonData = data;
        return res as Response;
    };
    // @ts-ignore
    res.send = (data?: any) => {
        res.sent = data;
        return res as Response;
    };
    return res as Response & { statusCode?: number; jsonData?: any; sent?: any };
}

// Type helper to make TS happy about stubbing
const TenantRepo = (TenantRepoMod as any).TenantRepo as {
    all: Function;
    findById: Function;
    findBySlug: Function;
    create: Function;
    update: Function;
    softDelete: Function;
};

export async function tenantControllerTests() {
    logger.info("▶ TenantController: starting tests");

    // index
    TenantRepo.all = async () => [{ id: 1, slug: "acme", name: "Acme" }];
    {
        const req = { query: {} } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.index(req, res);
        logger.debug("index()", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 200);
        // Don’t assume shape — just assert something was returned
        assert.ok(res.jsonData, "index should return body");
    }

    // show found
    TenantRepo.findById = async (id: number) => (id === 2 ? { id: 2, slug: "globex", name: "Globex" } : null);
    {
        const req = { params: { id: "2" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.show(req, res);
        logger.debug("show(2)", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 200);
        assert.ok(res.jsonData, "show should return body");
    }

    // show not found
    {
        const req = { params: { id: "999" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.show(req, res);
        logger.debug("show(999)", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 404);
        assert.ok(res.jsonData?.error, "show (not found) should return {error}");
    }

    // showBySlug found
    TenantRepo.findBySlug = async (slug: string) => (slug === "initech" ? { id: 3, slug, name: "Initech" } : null);
    {
        const req = { params: { slug: "initech" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.showBySlug(req, res);
        logger.debug("showBySlug('initech')", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 200);
        assert.ok(res.jsonData, "showBySlug should return body");
    }

    // showBySlug not found
    {
        const req = { params: { slug: "nope" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.showBySlug(req, res);
        logger.debug("showBySlug('nope')", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 404);
        assert.ok(res.jsonData?.error, "showBySlug (not found) should return {error}");
    }

    // store (use validated body like your middleware would attach)
    TenantRepo.findBySlug = async () => null;
    TenantRepo.create = async (payload: any) => ({ id: 10, ...payload });
    {
        const req = { validated: { body: { slug: "umbrella", name: "Umbrella", email: null, meta: null, is_active: true } } } as any;
        const res = mockRes();
        // @ts-ignore
        await TenantController.store(req, res);
        logger.debug("store()", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 201);
        assert.ok(res.jsonData, "store should return created body");
    }

    // update found
    TenantRepo.update = async (id: number, data: any) => (id === 10 ? { id, slug: "umbrella", name: data.name } : null);
    {
        const req = { params: { id: "10" }, validated: { body: { name: "Umbrella, Inc." } } } as any;
        const res = mockRes();
        // @ts-ignore
        await TenantController.update(req, res);
        logger.debug("update(10)", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 200);
        assert.ok(res.jsonData, "update should return updated body");
    }

    // update not found
    {
        const req = { params: { id: "777" }, validated: { body: { name: "X" } } } as any;
        const res = mockRes();
        // @ts-ignore
        await TenantController.update(req, res);
        logger.debug("update(777)", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 404);
        assert.ok(res.jsonData?.error, "update (not found) should return {error}");
    }

    // destroy found
    TenantRepo.softDelete = async (id: number) => id === 10;
    {
        const req = { params: { id: "10" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.destroy(req, res);
        logger.debug("destroy(10)", { statusCode: res.statusCode, sent: res.sent });
        assert.equal(res.statusCode, 204);
        assert.equal(res.sent, undefined);
    }

    // destroy not found
    {
        const req = { params: { id: "123" } } as unknown as Request;
        const res = mockRes();
        // @ts-ignore
        await TenantController.destroy(req, res);
        logger.debug("destroy(123)", { statusCode: res.statusCode, result: res.jsonData });
        assert.equal(res.statusCode, 404);
        assert.ok(res.jsonData?.error, "destroy (not found) should return {error}");
    }

    logger.info("✔ TenantController: all tests passed");
}
