# 📦 Codexsun

Codexsun is organized as a **monorepo** that separates
the shared framework (`cortex`) from application code (`apps`).  
The framework layer provides database engines, migrations, and settings 
that can be reused by any app, while each application (e.g., `cxsun`) manages 
its own domain logic, routes, and migrations.

This structure makes it easy to:
- ✅ share core functionality across multiple apps
- ✅ keep application-specific logic isolated
- ✅ scale with new apps or modules without breaking the framework

Below is the detailed repository structure with folders and files explained.

```
📦 codexsun/                         # root project
├── 📄 package.json
├── 📄 pnpm-lock.yaml
├── 📄 pnpm-workspace.yaml
├── 🖥️ index.ts                     # server entry, bootstraps app
├── 📄 tsconfig.json
│
├── 🧩 cortex/                       # framework (shared infra)
│   ├── 🗄️ database/                 # db engine & abstractions
│   │   ├── ⚙️ Engine.ts
│   │   ├── ▶️ Runner.ts
│   │   ├── 🏗️ Builder.ts
│   │   ├── 📐 Blueprint.ts
│   │   ├── 🔌 connection.ts
│   │   ├── 🔧 connection_manager.ts
│   │   ├── 📋 getDbConfig.ts
│   │   ├── 📑 types.ts
│   │   ├── 📊 tracking.ts
│   │   ├── 🔍 discover.ts
│   │   ├── 🐘 postgres.ts
│   │   ├── 🐬 mariadb.ts
│   │   ├── 📀 sqlite.ts
│   │   ├── 🚀 engines/
│   │   │    ├── postgres_engine.ts
│   │   │    ├── mariadb_engine.ts
│   │   │    └── sqlite_engine.ts
│   │   │
│   │   ├──


│   ├── 📝 migration/                # framework-level migrations (if any)
│   │   └── (empty for now)
│   │
│   └── ⚙️ settings/                 # env, security, logging
│       ├── 🌍 env.ts
│       ├── 🛡️ security.ts
│       └── 📜 logger.ts
│
├── 📂 apps/
│        └── 🌞 cxsun/                    # base application
│               ├── 📄 package.json
│               ├── 📄 tsconfig.json
│               ├── 🌐 index.html
│               ├── 🚪 app.ts                # app entry (mounts routes, middleware)
│               ├── 🎬 index.tsx         # app bootstrap
│               │
│               ├── 📂 src/
│               │
│               ├── 🛣️ route/
│               │   ├── 🔌 api/
│               │   │   └── 1️⃣ v1/
│               │   │       ├── 🗂️ tenants.routes.ts
│               │   │       └── 🌐 tenants.http.ts
│               │   │
│               │   └── 🌍 web/              # (optional frontend/web routes)
│               │
│               ├── 💡 core/
│               │   ├── 🏢 tenants/          # tenant domain logic
│               │   │   ├── 🧾 tenant.model.ts
│               │   │   ├── 📏 tenant.schemas.ts
│               │   │   ├── 🛠️ tenant.service.ts
│               │   │   ├── 💾 tenant.repo.ts
│               │   │   └── ❗ tenant.errors.ts
│               │   │
│               │   ├── 🧱 middlewares/
│               │   │   ├── 🪪 requestId.ts
│               │   │   ├── 🚨 errorHandler.ts
│               │   │   ├── 🏷️ tenantResolution.ts
│               │   │   ├── ✅ validate.ts
│               │   │   └── 🔐 auth.ts
│               │   │
│               │   └── 🧰 utils/
│               │       ├── ⏭️ pagination.ts
│               │       └── 🔎 query.ts
│               │
│               ├── 🗄️ database/
│               │   ├── 📝 migration/
│               │   │   └── 0001_tenants.table.ts
│               │   │
│               │   └── 🌱 seeders/
│               │       └── 0001_tenants.seed.ts
│               │
│               └── 🧪 tests/
│               ├── 🌐 tenants.e2e.test.ts
│               └── 🔬 tenants.service.test.ts
```

---