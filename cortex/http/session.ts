// cortex/session.ts — tiny in-memory session store
type SessionData = Record<string, any>;
interface Session {
    id: string;
    data: SessionData;
    createdAt: number;
    updatedAt: number;
    ttlMs: number;
}

const store = new Map<string, Session>();
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 2; // 2h

export function createSession(ttlMs = DEFAULT_TTL_MS): Session {
    const id = cryptoRandom();
    const now = Date.now();
    const s: Session = { id, data: {}, createdAt: now, updatedAt: now, ttlMs };
    store.set(id, s); return s;
}
export function getSession(id: string): Session | null {
    const s = store.get(id);
    if (!s) return null;
    if (Date.now() - s.updatedAt > s.ttlMs) { store.delete(id); return null; }
    return s;
}
export function updateSession(id: string, patch: Partial<SessionData>): Session | null {
    const s = getSession(id); if (!s) return null;
    Object.assign(s.data, patch); s.updatedAt = Date.now(); return s;
}
export function destroySession(id: string) { store.delete(id); }
export function cleanupSessions() {
    const now = Date.now();
    for (const [id, s] of store) if (now - s.updatedAt > s.ttlMs) store.delete(id);
}
function cryptoRandom() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
}
