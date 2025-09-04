// cortex/http/respond.ts
import { json } from './chttpx';

export const ok = <T>(res: any, body: T) => json(res, 200, body);
export const created = <T>(res: any, body: T) => json(res, 201, body);
export const noContent = (res: any) => json(res, 204, null);
export const badRequest = (res: any, message = 'Bad Request', extra: any = {}) =>
    json(res, 400, { ok: false, error: 'BAD_REQUEST', message, ...extra });
export const notFound = (res: any, message = 'Not Found') =>
    json(res, 404, { ok: false, error: 'NOT_FOUND', message });
export const serverError = (res: any, message = 'Internal Error', extra: any = {}) =>
    json(res, 500, { ok: false, error: 'INTERNAL', message, ...extra });
