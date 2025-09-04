// cortex/http/respond.ts
import { json } from './chttpx';

// ✅ json(res, body, status)
export const ok = <T>(res: any, body: T) => json(res, body, 200);
export const created = <T>(res: any, body: T) => json(res, body, 201);
export const noContent = (res: any) => json(res, null, 204);

export const badRequest = (res: any, message = 'Bad Request', extra: any = {}) =>
    json(res, { ok: false, error: 'BAD_REQUEST', message, ...extra }, 400);

export const notFound = (res: any, message = 'Not Found') =>
    json(res, { ok: false, error: 'NOT_FOUND', message }, 404);

export const serverError = (res: any, message = 'Internal Error', extra: any = {}) =>
    json(res, { ok: false, error: 'INTERNAL', message, ...extra }, 500);
