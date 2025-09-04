// cortex/http/auth/scope.ts
// Minimal RBAC helper used by tests or upstream server middleware
export type AuthContext = { sub?: string; scopes?: string[] };
export function attachAuth(req: any, ctx: AuthContext) {
    (req as any).auth = { ...(req as any).auth, ...ctx };
    return req;
}
