perfect — here’s a **single consolidated table** mapping **routes → controller → action → service/repo** for **tenant**, **user**, and **auth** modules.

---

# 📑 Route-to-File Map

| **HTTP Route**                               | **Controller**          | **Action File**                     | **Service / Repo**                           | **Notes (Guards/DTOs/Policies)**                               |
| -------------------------------------------- | ----------------------- | ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| **TENANT**                                   |                         |                                     |                                              |                                                                |
| `POST /tenants`                              | `Tenants.controller.ts` | `CreateTenant.action.ts`            | `Tenant.service.ts` → `Tenant.repository.ts` | Guard: `JwtAuth.guard.ts` · DTO: `CreateTenant.dto.ts`         |
| `GET /tenants`                               | `Tenants.controller.ts` | `ListTenants.action.ts`             | `Tenant.service.ts` → `Tenant.repository.ts` | Query: `ListTenants.query.ts`                                  |
| `GET /tenants/:tenantId`                     | `Tenants.controller.ts` | `GetTenant.action.ts`               | `Tenant.service.ts`                          | Param: `TenantId.param.ts`                                     |
| `PATCH /tenants/:tenantId`                   | `Tenants.controller.ts` | `UpdateTenant.action.ts`            | `Tenant.service.ts`                          | DTO: `UpdateTenant.dto.ts` · Policy: `TenantOwner.policy.ts`   |
| `DELETE /tenants/:tenantId`                  | `Tenants.controller.ts` | `DeleteTenant.action.ts`            | `Tenant.service.ts`                          | Soft delete · Policy: `TenantOwner.policy.ts`                  |
| `POST /tenants/:tenantId/deactivate`         | `Tenants.controller.ts` | `DeactivateTenant.action.ts`        | `Tenant.service.ts`                          | Policy: `TenantOwner.policy.ts`                                |
| `POST /tenants/:tenantId/reactivate`         | `Tenants.controller.ts` | `ReactivateTenant.action.ts`        | `Tenant.service.ts`                          | Policy: `TenantOwner.policy.ts`                                |
| `POST /tenants/:tenantId/transfer-ownership` | `Tenants.controller.ts` | `TransferTenantOwnership.action.ts` | `Tenant.service.ts`                          | Policy: `TenantOwner.policy.ts`                                |
| **USER**                                     |                         |                                     |                                              |                                                                |
| `POST /users`                                | `Users.controller.ts`   | `RegisterUser.action.ts`            | `User.service.ts` → `User.repository.ts`     | DTO: `RegisterUser.dto.ts`                                     |
| `POST /users/invitations`                    | `Users.controller.ts`   | `InviteUser.action.ts`              | `User.service.ts`                            | DTO: `InviteUser.dto.ts` · Policy: `CanManageUsers.policy.ts`  |
| `POST /users/invitations/accept`             | `Users.controller.ts`   | `AcceptInvitation.action.ts`        | `User.service.ts`                            | DTO: `AcceptInvitation.dto.ts`                                 |
| `GET /users`                                 | `Users.controller.ts`   | `ListUsers.action.ts`               | `User.service.ts`                            | Query: `ListUsers.query.ts`                                    |
| `GET /users/search`                          | `Users.controller.ts`   | `SearchUsers.action.ts`             | `User.service.ts`                            | Query: `SearchUsers.query.ts`                                  |
| `GET /users/:userId`                         | `Users.controller.ts`   | `GetUser.action.ts`                 | `User.service.ts`                            | Param: `UserId.param.ts` · Policy: `UserSelfOrAdmin.policy.ts` |
| `PATCH /users/:userId`                       | `Users.controller.ts`   | `UpdateUser.action.ts`              | `User.service.ts`                            | DTO: `UpdateUser.dto.ts` · Policy: `UserSelfOrAdmin.policy.ts` |
| `POST /users/:userId/deactivate`             | `Users.controller.ts`   | `DeactivateUser.action.ts`          | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| `POST /users/:userId/reactivate`             | `Users.controller.ts`   | `ReactivateUser.action.ts`          | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| `POST /users/:userId/roles`                  | `Users.controller.ts`   | `AssignRole.action.ts`              | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| `DELETE /users/:userId/roles/:role`          | `Users.controller.ts`   | `RevokeRole.action.ts`              | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| `POST /users/:userId/permissions`            | `Users.controller.ts`   | `GrantPermission.action.ts`         | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| `DELETE /users/:userId/permissions/:perm`    | `Users.controller.ts`   | `RevokePermission.action.ts`        | `User.service.ts`                            | Policy: `ManageRoles.policy.ts`                                |
| **AUTH**                                     |                         |                                     |                                              |                                                                |
| `POST /auth/login`                           | `Auth.controller.ts`    | `AuthenticateUser.action.ts`        | `Auth.service.ts` + `Tokens.service.ts`      | DTO: `Login.dto.ts` · Strategy: `Local.strategy.ts`            |
| `POST /auth/logout`                          | `Auth.controller.ts`    | `Logout.action.ts`                  | `Auth.service.ts` + `Session.repository.ts`  | Guard: `JwtAuth.guard.ts`                                      |
| `POST /auth/refresh`                         | `Auth.controller.ts`    | `RefreshToken.action.ts`            | `Tokens.service.ts`                          | DTO: `RefreshToken.dto.ts` · Guard: `OptionalJwt.guard.ts`     |
| `POST /auth/password/request-reset`          | `Auth.controller.ts`    | `RequestPasswordReset.action.ts`    | `Passwords.service.ts`                       | DTO: `RequestPasswordReset.dto.ts`                             |
| `POST /auth/password/reset`                  | `Auth.controller.ts`    | `ResetPassword.action.ts`           | `Passwords.service.ts`                       | DTO: `ResetPassword.dto.ts`                                    |
| `POST /auth/mfa/enable`                      | `Auth.controller.ts`    | `EnableMfa.action.ts`               | `Mfa.service.ts`                             | DTO: `EnableMfa.dto.ts` · Guard: `JwtAuth.guard.ts`            |
| `POST /auth/mfa/verify`                      | `Auth.controller.ts`    | `VerifyMfa.action.ts`               | `Mfa.service.ts`                             | DTO: `VerifyMfa.dto.ts` · Guard: `JwtAuth.guard.ts`            |
| `POST /auth/mfa/disable`                     | `Auth.controller.ts`    | `DisableMfa.action.ts`              | `Mfa.service.ts`                             | Guard: `JwtAuth.guard.ts`                                      |

---

this table gives you a **one-glance index** of every endpoint → file → service, consistent across modules.

👉 do you want me to also add **middleware & interceptors per route group** (like tenant has `TenantHeader.middleware.ts` etc) in a second table, or keep them implicit for now?


awesome — here’s the **per–route-group pipeline table** (middleware, guards, interceptors, pipes, policies, decorators). names only, no code.

---

# 🌐 Global (applies app-wide unless overridden)

| Layer                | Files                                                                                       | Notes                                                |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Middleware**       | `RequestLogger.middleware.ts` → `AuthContext.middleware.ts` → `TenantContext.middleware.ts` | order matters (logger first, then user, then tenant) |
| **Guards**           | `OptionalJwt.guard.ts` (default for public GETs)                                            | override per route with `JwtAuth.guard.ts`           |
| **Interceptors**     | `ResponseTime.interceptor.ts`, `Serialization.interceptor.ts`                               | response timing + DTO-based shaping                  |
| **Pipes**            | `Validation.pipe.ts`, `ParseObjectId.pipe.ts`                                               | body/query/param validation & ID parsing             |
| **Exception Filter** | `HttpException.filter.ts`                                                                   | maps domain/app errors → HTTP                        |
| **Context**          | `ExecutionContext.ts`, `HttpContext.ts`, `CallHandler.ts`                                   | request-scoped bag (user, tenant, trace)             |

---

# 🏢 Tenant routes (`/tenants*`)

| Concern          | Files                                                                | Scope / When                                                       |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Middleware**   | `TenantHeader.middleware.ts`, `TenantContext.middleware.ts`          | all tenant routes; resolves `X-Tenant-ID` → context                |
| **Guards**       | `JwtAuth.guard.ts`                                                   | all except public provisioning (if any)                            |
| **Policies**     | `TenantOwner.policy.ts`, `TenantAdmin.policy.ts`                     | owner/admin gates for update/delete/deactivate/reactivate/transfer |
| **Interceptors** | `TenantSerialization.interceptor.ts`, `Serialization.interceptor.ts` | entity → response mapping; add tenant meta if needed               |
| **Pipes**        | `Validation.pipe.ts`, `ParseObjectId.pipe.ts`                        | validate `tenantId`, bodies & queries                              |
| **Decorators**   | `CurrentTenant.decorator.ts`                                         | inject current tenant in handlers                                  |

**Effective pipeline order:**
`RequestLogger` → `AuthContext` → **`TenantHeader`** → `TenantContext` → Guard (`JwtAuth`) → Policy (Owner/Admin) → Pipes (Validation/ParseObjectId) → Controller → Interceptors (TenantSerialization/Serialization) → ExceptionFilter

---

# 👤 User routes (`/users*`)

| Concern          | Files                                                                                   | Scope / When                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Middleware**   | `AuthContext.middleware.ts`, `CurrentUser.middleware.ts`, `TenantContext.middleware.ts` | all user routes                                                               |
| **Guards**       | `JwtAuth.guard.ts`                                                                      | required for list/get/update/role/perm ops; optional for public self-register |
| **Policies**     | `UserSelfOrAdmin.policy.ts`, `ManageRoles.policy.ts`                                    | protect read/update self vs admin; role/perm ops                              |
| **Interceptors** | `UserSerialization.interceptor.ts`, `Serialization.interceptor.ts`                      | hide sensitive fields, shape lists                                            |
| **Pipes**        | `Validation.pipe.ts`, `ParseObjectId.pipe.ts`                                           | `userId` params, list/search queries                                          |
| **Decorators**   | `CurrentUser.decorator.ts`, `CurrentTenant.decorator.ts`                                | inject actor & tenant                                                         |

**Effective pipeline order:**
`RequestLogger` → `AuthContext` → `CurrentUser` → `TenantContext` → Guard (`JwtAuth` or `OptionalJwt`) → Policy (SelfOrAdmin / ManageRoles) → Pipes → Controller → Interceptors → ExceptionFilter

---

# 🔐 Auth routes (`/auth*`)

| Concern          | Files                                                              | Scope / When                                    |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| **Middleware**   | `AuthContext.middleware.ts`                                        | always (to attach partial context if present)   |
| **Guards**       | `OptionalJwt.guard.ts` (default), `JwtAuth.guard.ts` (logout/mfa)  | public login & refresh can be optional          |
| **Strategies**   | `Local.strategy.ts`, `Jwt.strategy.ts`, `RefreshJwt.strategy.ts`   | login, protected endpoints, token refresh       |
| **Interceptors** | `AuthSerialization.interceptor.ts`, `Serialization.interceptor.ts` | normalize token/session payloads                |
| **Pipes**        | `Validation.pipe.ts`                                               | login/reset/mfa DTOs                            |
| **Decorators**   | `Public.decorator.ts`, `CurrentUser.decorator.ts`                  | mark public handlers; inject user for protected |

**Effective pipeline order:**
`RequestLogger` → `AuthContext` → Guard (`Public`/`OptionalJwt` or `JwtAuth`) → Strategy (Local/Jwt/RefreshJwt) → Pipes → Controller → Interceptors → ExceptionFilter

---

# ⚙️ Route-specific overrides (quick matrix)

| Route                                                             | Extra Enforcements                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `POST /tenants/:tenantId/transfer-ownership`                      | `TenantOwner.policy.ts`                               |
| `PATCH /users/:userId`                                            | `UserSelfOrAdmin.policy.ts`                           |
| `POST /users/:userId/roles` / `DELETE /users/:userId/roles/:role` | `ManageRoles.policy.ts`                               |
| `POST /auth/logout` / `POST /auth/mfa/*`                          | `JwtAuth.guard.ts`                                    |
| `POST /users` (register)                                          | may mark as `@Public` or keep `JwtAuth` if admin-only |

---

# 🧭 Notes for wiring

* **Order is king:** middleware (context) → guards → policies → pipes → controller → interceptors.
* **Serialization interceptors** should run **after** controller logic to shape responses uniformly.
* **Policies** are composable—prefer small, focused gates and combine in controllers.

Want me to add a **tiny legend** doc (1–2 lines each) describing what every middleware/guard/interceptor does for your `/docs` folder (still names & purpose only)?

