perfect — let’s turn the giant tenant checklist into a **numbered TODO list by phase** so you can point me to “phase 2” or “task 3.1” etc.

---

# 🗂 Tenant TODO by Phase

## **Phase 1 — Design Freeze**

1.1 Confirm tenancy model (shared DB + `tenant_id` on scoped tables).
1.2 Approve final route surface (incl. members/invites/keys/audit).
1.3 Lock role/scope matrix & policy predicates.
1.4 Finalize DTO shapes & validation rules.
1.5 Approve status transitions & lifecycle (active ↔ suspended, archived rules).

---

## **Phase 2 — Database & Storage**

2.1 Define `tenants` table schema (uuid PK, slug unique, name, status, meta JSON, timestamps, version).
2.2 Define `memberships` table schema (tenant\_id, user\_id, role, timestamps).
2.3 Define `invites` table schema (token, tenant\_id, email, role, expiresAt, acceptedAt?).
2.4 Define `apikeys` table schema (id, tenant\_id, hash, scopes, lastUsedAt, revokedAt?).
2.5 Define `audit` table schema (tenant\_id, actor, action, resource, diff, timestamps).
2.6 Add indexes (slug unique, `(tenant_id,user_id)` unique, audit ordering).
2.7 Decide JSON portability strategy across sqlite/postgres/mariadb.

---

## **Phase 3 — Middleware & Policies**

3.1 Global middleware contracts (requestId, auth, rateLimit, error, validate).
3.2 Tenant middlewares: `tenantResolver`, `scopeGuard`, `idempotency`, `etag`, `pagination`.
3.3 Policy functions: `canReadTenant`, `canUpdateTenant`, `canDeleteTenant`, `canManageMembers`, `canInvite`, `cannotDemoteLastOwner`, `suspendedReadOnly`.
3.4 Configure scope enforcement (`tenant:read`, `tenant:write`, etc).

---

## **Phase 4 — Use-Cases & Services**

4.1 Implement UC for tenants (create, list, get, update, delete).
4.2 Implement UC for members (add, list, update, remove).
4.3 Implement UC for invites (create, accept).
4.4 Implement UC for API keys (rotate).
4.5 Implement UC for audit (list).
4.6 Ensure UCs emit domain events for audit logging.

---

## **Phase 5 — Controllers & Routes**

5.1 Wire tenant routes to handlers (create, list, get, update, remove).
5.2 Wire member routes to handlers (add/list/update/remove).
5.3 Wire invite routes (create/accept).
5.4 Wire API key rotation route.
5.5 Wire audit listing route.
5.6 Map controller ↔ use-case ↔ repo responses with ETag & Location headers.

---

## **Phase 6 — Testing**

6.1 Write HTTP E2E tests: all routes, auth errors, policy errors, edge cases.
6.2 Write UC unit tests: happy paths, invalid input, repo error propagation.
6.3 Write Repo integration tests: indices, FK constraints, cursor pagination.
6.4 Seed fixtures/factories for tenants, members, invites, keys.
6.5 Verify special cases: duplicate slug conflict, last owner demotion, invite expiry, suspended tenant behavior.

---

## **Phase 7 — Ops & Observability**

7.1 Structured logs (reqId, user, tenant, action, latency, outcome).
7.2 Metrics (per-route latency, error rate, DB calls, rate-limit hits).
7.3 Audit event catalog (`TENANT_CREATED`, `MEMBER_ADDED`, etc).
7.4 Decide audit retention & PII redaction policy.
7.5 Rate-limit policies per route group.

---

## **Phase 8 — Documentation**

8.1 Add `docs/tenants.md` with route map, DTOs, error codes, policy matrix.
8.2 Add README in `domain/tenants/` describing model, use-cases, repo.
8.3 Add error catalog in `core/http/errors`.
8.4 Add schemas in `core/http/schemas`.

---

👉 with this breakdown you can now say something like:

* *“let’s do Phase 2 task 2.1 → code next”*
* or *“pause at Phase 3, list policies only”*

Do you want me to **start coding from Phase 1** (schemas + migrations) or **Phase 2** (DB storage), or do you want to lock design first?
