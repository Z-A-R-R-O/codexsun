// Tiny path matcher that supports /users/:id and wildcards *
export interface MatchResult {
  ok: boolean;
  params: Record<string, string>;
}

export function matchPath(pattern: string, pathname: string): MatchResult {
  if (pattern === pathname) return { ok: true, params: {} };
  const p = pattern.split('/').filter(Boolean);
  const u = pathname.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  if (p.length !== u.length) return { ok: false, params: {} };
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    const val = u[i];
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(val);
    } else if (seg === '*') {
      // wildcard consumes this single segment
      continue;
    } else if (seg !== val) {
      return { ok: false, params: {} };
    }
  }
  return { ok: true, params };
}
