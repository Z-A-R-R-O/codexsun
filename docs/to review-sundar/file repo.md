awesome—let’s lock down a clean naming scheme (à la Nest) and a full file map for just **tenant**, **user**, and **auth**. no code yet—only names, structure, and what each file is for.

# naming rules (aligned with your examples)

* **Controllers**: `Xxxs.controller.ts` (e.g., `Tenants.controller.ts`, `Users.controller.ts`, `Auth.controller.ts`)
* **Services**: `Xxx.service.ts` (domain/application services)
* **Middleware**: `Xxx.middleware.ts` (e.g., `AuthContext.middleware.ts`)
* **Guards**: `Xxx.guard.ts` (e.g., `JwtAuth.guard.ts`)
* **Interceptors**: `Xxx.interceptor.ts`
* **Pipes / Validators**: `Xxx.pipe.ts`, `Xxx.validator.ts`
* **Policies (authorization rules)**: `Xxx.policy.ts`
* **Models (entities/aggregates)**: `Xxx.model.ts`
* **Repositories**: `Xxx.repository.ts`
* **DTOs**: `CreateXxx.dto.ts`, `UpdateXxx.dto.ts`, `ListXxx.query.ts`, `XxxId.param.ts`
* **Actions (use-cases)**: `VerbXxx.action.ts` (e.g., `CreateTenant.action.ts`)
* **Context**: `ExecutionContext.ts`, `HttpContext.ts`
* **Call handler interface**: `CallHandler.ts` (for interceptors/pipelines)

---

# monorepo placement (recap)

* `cortex/` → shared framework (db engines, migrations, settings)
* `apps/cxsun/` → app code (our domain stuff below)
* keep app-level “core” that plugs into `cortex` but stays app-specific.

---

# repo tree — core (app-level infra)

*(shared across tenant/user/auth; no business logic here)*

```
apps/cxsun/core/
  http/
    ExecutionContext.ts
    HttpContext.ts
    CallHandler.ts
    exceptions/
      HttpException.filter.ts
    middleware/
      AuthContext.middleware.ts
      TenantContext.middleware.ts
      RequestLogger.middleware.ts
    guards/
      JwtAuth.guard.ts
      Roles.guard.ts
      Permissions.guard.ts
      OptionalJwt.guard.ts
    interceptors/
      ResponseTime.interceptor.ts
      Serialization.interceptor.ts
      TenantTransform.interceptor.ts
    pipes/
      ParseObjectId.pipe.ts
      Validation.pipe.ts
  auth/
    decorators/
      CurrentUser.decorator.ts
      CurrentTenant.decorator.ts
      Public.decorator.ts
    strategies/
      Local.strategy.ts
      Jwt.strategy.ts
      RefreshJwt.strategy.ts
    policies/
      IsTenantOwner.policy.ts
      CanManageUsers.policy.ts
  validation/
    schemas/
      Email.schema.ts
      Password.schema.ts
    validators/
      NonEmptyString.validator.ts
  logging/
    Logger.service.ts
  events/
    EventBus.service.ts
    DomainEvents.map.ts
  persistence/
    BaseRepository.ts
    UnitOfWork.ts
    Transactional.decorator.ts
```

---

# repo tree — tenant module

```
apps/cxsun/modules/tenant/
  Tenants.controller.ts
  Tenant.service.ts
  Tenant.model.ts
  Tenant.repository.ts
  actions/
    CreateTenant.action.ts
    UpdateTenant.action.ts
    DeactivateTenant.action.ts
    ReactivateTenant.action.ts
    DeleteTenant.action.ts
    TransferTenantOwnership.action.ts
    ListTenants.action.ts
    GetTenant.action.ts
  dtos/
    CreateTenant.dto.ts
    UpdateTenant.dto.ts
    TenantId.param.ts
    ListTenants.query.ts
  policies/
    TenantOwner.policy.ts
    TenantAdmin.policy.ts
  validators/
    TenantName.validator.ts
  interceptors/
    TenantSerialization.interceptor.ts
  middleware/
    TenantHeader.middleware.ts        // resolves X-Tenant-ID -> HttpContext
```

**scenarios covered**

* CRUD: create, get, update, delete
* lifecycle: deactivate/reactivate
* admin: transfer ownership
* queries: list (paginated, filterable)

---

# repo tree — user module

```
apps/cxsun/modules/user/
  Users.controller.ts
  User.service.ts
  User.model.ts
  User.repository.ts
  actions/
    RegisterUser.action.ts
    InviteUser.action.ts
    AcceptInvitation.action.ts
    UpdateUser.action.ts
    DeactivateUser.action.ts
    ReactivateUser.action.ts
    AssignRole.action.ts
    RevokeRole.action.ts
    GrantPermission.action.ts
    RevokePermission.action.ts
    GetUser.action.ts
    ListUsers.action.ts
    SearchUsers.action.ts
  dtos/
    RegisterUser.dto.ts
    InviteUser.dto.ts
    AcceptInvitation.dto.ts
    UpdateUser.dto.ts
    UserId.param.ts
    ListUsers.query.ts
    SearchUsers.query.ts
  policies/
    UserSelfOrAdmin.policy.ts
    ManageRoles.policy.ts
  validators/
    UserName.validator.ts
  interceptors/
    UserSerialization.interceptor.ts
  middleware/
    CurrentUser.middleware.ts
```

**scenarios covered**

* CRUD: register/create, get, update, deactivate/reactivate
* invitations: invite, accept
* access control: assign/revoke roles & permissions
* queries: list, search (by name/email/role)

---

# repo tree — auth module

```
apps/cxsun/modules/auth/
  Auth.controller.ts
  Auth.service.ts
  Session.model.ts
  Session.repository.ts
  Tokens.service.ts
  Passwords.service.ts
  Mfa.service.ts
  actions/
    AuthenticateUser.action.ts
    Logout.action.ts
    RefreshToken.action.ts
    RequestPasswordReset.action.ts
    ResetPassword.action.ts
    EnableMfa.action.ts
    VerifyMfa.action.ts
    DisableMfa.action.ts
  dtos/
    Login.dto.ts
    RefreshToken.dto.ts
    RequestPasswordReset.dto.ts
    ResetPassword.dto.ts
    EnableMfa.dto.ts
    VerifyMfa.dto.ts
  guards/
    JwtAuth.guard.ts
    OptionalJwt.guard.ts
  strategies/
    Local.strategy.ts
    Jwt.strategy.ts
    RefreshJwt.strategy.ts
  interceptors/
    AuthSerialization.interceptor.ts
```

**scenarios covered**

* auth flows: login, logout, refresh
* password flows: request reset, reset
* MFA flows: enable, verify, disable
* sessions: persist & revoke

---

# controller → action → service → repo flow (usage pattern)

* **Controller** receives HTTP, validates with **DTOs/Pipes**, enforces **Guards/Policies**.
* Controller calls a single **Action** (use-case).
* **Action** orchestrates business rules, invokes **Services**.
* **Service** performs domain logic, uses **Repositories** (and **UnitOfWork** when needed).
* **Interceptors** (e.g., `Serialization.interceptor.ts`) shape the response.
* **Middleware** (`AuthContext`, `TenantContext`) builds **HttpContext/ExecutionContext** early in the pipeline.

Example mappings (names only):

* `POST /tenants` → `CreateTenant.action.ts` → `Tenant.service.ts` → `Tenant.repository.ts`
* `GET /tenants` → `ListTenants.action.ts`
* `POST /auth/login` → `AuthenticateUser.action.ts` → `Auth.service.ts` + `Tokens.service.ts`
* `POST /users/:id/roles` → `AssignRole.action.ts` → `User.service.ts` + `User.repository.ts`

---

# consistency picks (so we don’t waver later)

* **Use-case suffix**: **`.action.ts`** (short, readable)
* **Plural controllers**: `Tenants.controller.ts`, `Users.controller.ts`, `Auth.controller.ts`
* **DTOs** are singular and imperative: `CreateTenant.dto.ts`, `Login.dto.ts`
* **Policies** for fine-grained authorization: `TenantOwner.policy.ts`, `ManageRoles.policy.ts`
* **Context files** live in `core/http/`: `ExecutionContext.ts`, `HttpContext.ts`, `CallHandler.ts`

---

# optional (nice-to-have, still names only)

* `apps/cxsun/modules/user/Avatar.service.ts` (uploads/processing)
* `apps/cxsun/modules/tenant/Billing.service.ts` (if billing later)
* `apps/cxsun/modules/auth/WebAuthn.service.ts` (future MFA mode)
* `apps/cxsun/core/events/*` for domain events like `UserRegistered`, `TenantCreated`

---

if this naming looks good, i’ll derive the **route-to-file map** (all endpoints for tenant/user/auth) and then we can go “code next”.


sweet — locking it in. here’s the **complete repo map** (core + tenant/user/auth) and the **route → file mapping** with all scenarios (CRUD, list, plus extras). filenames only, no code.

# core (app-level infra)

```
apps/cxsun/core/
  http/
    ExecutionContext.ts
    HttpContext.ts
    CallHandler.ts
    exceptions/
      HttpException.filter.ts
    middleware/
      AuthContext.middleware.ts
      TenantContext.middleware.ts
      RequestLogger.middleware.ts
    guards/
      JwtAuth.guard.ts
      OptionalJwt.guard.ts
      Roles.guard.ts
      Permissions.guard.ts
    interceptors/
      ResponseTime.interceptor.ts
      Serialization.interceptor.ts
      TenantTransform.interceptor.ts
    pipes/
      Validation.pipe.ts
      ParseObjectId.pipe.ts
  auth/
    decorators/
      CurrentUser.decorator.ts
      CurrentTenant.decorator.ts
      Public.decorator.ts
    strategies/
      Local.strategy.ts
      Jwt.strategy.ts
      RefreshJwt.strategy.ts
    policies/
      IsTenantOwner.policy.ts
      CanManageUsers.policy.ts
  validation/
    schemas/
      Email.schema.ts
      Password.schema.ts
    validators/
      NonEmptyString.validator.ts
  logging/
    Logger.service.ts
  events/
    EventBus.service.ts
    DomainEvents.map.ts
  persistence/
    BaseRepository.ts
    UnitOfWork.ts
    Transactional.decorator.ts
```

---

# tenant module

```
apps/cxsun/modules/tenant/
  Tenants.controller.ts
  Tenant.service.ts
  Tenant.model.ts
  Tenant.repository.ts
  actions/
    CreateTenant.action.ts
    GetTenant.action.ts
    ListTenants.action.ts
    UpdateTenant.action.ts
    DeleteTenant.action.ts
    DeactivateTenant.action.ts
    ReactivateTenant.action.ts
    TransferTenantOwnership.action.ts
  dtos/
    CreateTenant.dto.ts
    UpdateTenant.dto.ts
    TenantId.param.ts
    ListTenants.query.ts
  policies/
    TenantOwner.policy.ts
    TenantAdmin.policy.ts
  validators/
    TenantName.validator.ts
  interceptors/
    TenantSerialization.interceptor.ts
  middleware/
    TenantHeader.middleware.ts
```

### tenant routes → files (pipeline)

* `POST /tenants`
  → `Tenants.controller.ts` → `CreateTenant.action.ts` → `Tenant.service.ts` → `Tenant.repository.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantAdmin.policy.ts` (optional for self-provisioning)
  DTOs: `CreateTenant.dto.ts` • Pipes: `Validation.pipe.ts`

* `GET /tenants` (list: paginate/filter/sort)
  → `ListTenants.action.ts`
  Guards: `JwtAuth.guard.ts` • Query DTO: `ListTenants.query.ts`
  Interceptors: `Serialization.interceptor.ts`

* `GET /tenants/:tenantId`
  → `GetTenant.action.ts`
  Guards: `JwtAuth.guard.ts` • Params: `TenantId.param.ts`

* `PATCH /tenants/:tenantId`
  → `UpdateTenant.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantOwner.policy.ts`
  DTO: `UpdateTenant.dto.ts`

* `DELETE /tenants/:tenantId` (soft delete)
  → `DeleteTenant.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantOwner.policy.ts`

* `POST /tenants/:tenantId/deactivate`
  → `DeactivateTenant.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantOwner.policy.ts`

* `POST /tenants/:tenantId/reactivate`
  → `ReactivateTenant.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantOwner.policy.ts`

* `POST /tenants/:tenantId/transfer-ownership`
  → `TransferTenantOwnership.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `TenantOwner.policy.ts`

Cross-cutting middleware on tenant routes:

* `TenantHeader.middleware.ts` (resolve `X-Tenant-ID`)
* `TenantContext.middleware.ts` (bind to `HttpContext`)
* `RequestLogger.middleware.ts`

---

# user module

```
apps/cxsun/modules/user/
  Users.controller.ts
  User.service.ts
  User.model.ts
  User.repository.ts
  actions/
    RegisterUser.action.ts
    InviteUser.action.ts
    AcceptInvitation.action.ts
    GetUser.action.ts
    ListUsers.action.ts
    SearchUsers.action.ts
    UpdateUser.action.ts
    DeactivateUser.action.ts
    ReactivateUser.action.ts
    AssignRole.action.ts
    RevokeRole.action.ts
    GrantPermission.action.ts
    RevokePermission.action.ts
  dtos/
    RegisterUser.dto.ts
    InviteUser.dto.ts
    AcceptInvitation.dto.ts
    UpdateUser.dto.ts
    UserId.param.ts
    ListUsers.query.ts
    SearchUsers.query.ts
  policies/
    UserSelfOrAdmin.policy.ts
    ManageRoles.policy.ts
  validators/
    UserName.validator.ts
  interceptors/
    UserSerialization.interceptor.ts
  middleware/
    CurrentUser.middleware.ts
```

### user routes → files (pipeline)

* `POST /users` (register/create)
  → `RegisterUser.action.ts` • DTO: `RegisterUser.dto.ts`
  Guards: `JwtAuth.guard.ts` (optional if public sign-up)

* `POST /users/invitations`
  → `InviteUser.action.ts` • DTO: `InviteUser.dto.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `CanManageUsers.policy.ts`

* `POST /users/invitations/accept`
  → `AcceptInvitation.action.ts` • DTO: `AcceptInvitation.dto.ts`
  Guards: `OptionalJwt.guard.ts`

* `GET /users` (list)
  → `ListUsers.action.ts` • Query: `ListUsers.query.ts`
  Guards: `JwtAuth.guard.ts`

* `GET /users/search`
  → `SearchUsers.action.ts` • Query: `SearchUsers.query.ts`
  Guards: `JwtAuth.guard.ts`

* `GET /users/:userId`
  → `GetUser.action.ts` • Params: `UserId.param.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `UserSelfOrAdmin.policy.ts`

* `PATCH /users/:userId`
  → `UpdateUser.action.ts` • DTO: `UpdateUser.dto.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `UserSelfOrAdmin.policy.ts`

* `POST /users/:userId/deactivate` / `POST /users/:userId/reactivate`
  → `DeactivateUser.action.ts` / `ReactivateUser.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `ManageRoles.policy.ts` (or admin)

* `POST /users/:userId/roles` (assign)
  → `AssignRole.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `ManageRoles.policy.ts`

* `DELETE /users/:userId/roles/:role` (revoke)
  → `RevokeRole.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `ManageRoles.policy.ts`

* `POST /users/:userId/permissions` / `DELETE /users/:userId/permissions/:perm`
  → `GrantPermission.action.ts` / `RevokePermission.action.ts`
  Guards: `JwtAuth.guard.ts` • Policies: `ManageRoles.policy.ts`

Middleware on user routes:

* `AuthContext.middleware.ts` • `CurrentUser.middleware.ts` • `RequestLogger.middleware.ts`

---

# auth module

```
apps/cxsun/modules/auth/
  Auth.controller.ts
  Auth.service.ts
  Session.model.ts
  Session.repository.ts
  Tokens.service.ts
  Passwords.service.ts
  Mfa.service.ts
  actions/
    AuthenticateUser.action.ts
    Logout.action.ts
    RefreshToken.action.ts
    RequestPasswordReset.action.ts
    ResetPassword.action.ts
    EnableMfa.action.ts
    VerifyMfa.action.ts
    DisableMfa.action.ts
  dtos/
    Login.dto.ts
    RefreshToken.dto.ts
    RequestPasswordReset.dto.ts
    ResetPassword.dto.ts
    EnableMfa.dto.ts
    VerifyMfa.dto.ts
  guards/
    JwtAuth.guard.ts
    OptionalJwt.guard.ts
  strategies/
    Local.strategy.ts
    Jwt.strategy.ts
    RefreshJwt.strategy.ts
  interceptors/
    AuthSerialization.interceptor.ts
```

### auth routes → files (pipeline)

* `POST /auth/login`
  → `AuthenticateUser.action.ts` • DTO: `Login.dto.ts`
  Guards: `Public.decorator.ts` (skip auth) • Strategy: `Local.strategy.ts`

* `POST /auth/logout`
  → `Logout.action.ts`
  Guards: `JwtAuth.guard.ts`

* `POST /auth/refresh`
  → `RefreshToken.action.ts` • DTO: `RefreshToken.dto.ts`
  Guards: `OptionalJwt.guard.ts` • Strategy: `RefreshJwt.strategy.ts`

* `POST /auth/password/request-reset` / `POST /auth/password/reset`
  → `RequestPasswordReset.action.ts` / `ResetPassword.action.ts`
  DTOs: `RequestPasswordReset.dto.ts`, `ResetPassword.dto.ts`

* `POST /auth/mfa/enable` / `POST /auth/mfa/verify` / `POST /auth/mfa/disable`
  → `EnableMfa.action.ts` / `VerifyMfa.action.ts` / `DisableMfa.action.ts`
  DTOs: `EnableMfa.dto.ts`, `VerifyMfa.dto.ts`
  Guards: `JwtAuth.guard.ts`

---

# shared conventions (so everything “clicks”)

* **Use-case suffix**: `.action.ts` (simple & Nest-ish)
* **Plural controllers** (`Tenants`, `Users`, `Auth`)
* **DTOs** for body, **Query** for list/search filters, **Param** for path IDs
* **Guards/Policies** gate before controller handler
* **Interceptors** handle serialization/response shaping
* **Middleware** binds `TenantId` + `CurrentUser` into `HttpContext`
* **Events** (names only): `TenantCreated`, `TenantUpdated`, `TenantDeactivated`, `UserRegistered`, `UserInvited`, `UserDeactivated`, `UserRoleAssigned`, `AuthLoggedIn`, `AuthLoggedOut`, `PasswordResetRequested`, `MfaEnabled`, `MfaVerified`

### list/search query fields (names only)

* Common: `page`, `limit`, `sort`, `order`, `q`
* Tenant list filters: `status`, `ownerId`, `createdFrom`, `createdTo`
* User list/search filters: `status`, `role`, `email`, `name`, `tenantId`

### id & soft-delete

* IDs: `string` (ObjectId/UUID), parsed by `ParseObjectId.pipe.ts`
* Deletes: soft by default; include `?hard=true` only on admin paths if added later

---

# wiring (high level)

* server entry (`/index.ts`) mounts `apps/cxsun` app → registers `core/http` middlewares/guards/interceptors → mounts modules (`/modules/tenant`, `/modules/user`, `/modules/auth`) → each controller maps 1:1 to **action** files.

---

want me to add the **route-to-file map as a single table** (handy for docs), or proceed to “code next” for one module (e.g., Tenant) using this structure?
