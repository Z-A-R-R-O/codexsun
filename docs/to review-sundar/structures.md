# Codexsun App Structure (Concept)

A lightweight, scalable way to build multiple apps on top of a shared framework. **`cortex`** provides reusable database engines, migrations, and settings; each app under **`apps`** owns its domain logic, routes, and its *own* migrations/seeds. The goal: share the plumbing, isolate the product.

---

## 🎯 Design goals

* **Separation of concerns:** framework vs. application.
* **Reusability:** engines, runners, and settings live once in `cortex`.
* **Per‑app isolation:** each app ships with its own migrations, seeds, routes, and domain modules.
* **Plug‑and‑play apps:** add/remove an app without touching the framework.
* **Production‑ready:** clear env config, explicit boundaries, and predictable build/run scripts.

---

## 🗂️ Monorepo layout

```
📦 codexsun/
├─ 🧠 cortex/                     # framework layer (shared)
│  ├─ 🗄️ database/
│  │  ├─ ⚙️ engines/              # postgres_engine.ts, mariadb_engine.ts, sqlite_engine.ts
│  │  ├─ 🔌 connection/            # connection.ts, connection_manager.ts, types.ts
│  │  ├─ 🧭 config/                # getDbConfig.ts (env profiles)
│  │  └─ 📦 adapters/              # postgres.ts, mariadb.ts, sqlite.ts
│  ├─ 🧩 migration/                # Builder, Blueprint, Runner, tracking, discover
│  ├─ ⚙️ settings/                 # framework defaults & loaders
│  ├─ 🛠️ cli/                      # cx commands (migrate, doctor, etc.)
│  └─ 📚 docs/                     # framework docs
│
├─ 🧱 apps/
│  └─ 🌞 cxsun/                    # base application
│     ├─ 🧩 core/                  # app services, domain models, use-cases
│     ├─ 🛣️ routes/                # HTTP/API endpoints (if applicable)
│     ├─ 🗄️ database/
│     │  ├─ 🧭 migration/          # app-owned migrations
│     │  └─ 🌱 seed/               # app-owned seeders/fixtures
│     ├─ 📦 modules/               # feature folders (optional)
│     ├─ 🧪 tests/                 # app tests
│     └─ 📚 docs/                  # app docs (specs, ADRs)
│
├─ 🗃️ data/                        # datasets, fixtures, dumps
├─ 📖 docs/                        # product/repo docs (top-level)
├─ 🚀 index.ts                    # entrypoint: boot + mount selected app
├─ 📦 package.json
├─ 🧶 pnpm-workspace.yaml
├─ 🔒 tsconfig.json
└─ 🧹 tools/                       # scripts, generators, dev tooling
```

> **Boundary rule:** apps depend on `cortex` (one‑way). **`cortex` never imports from `apps/*`.**

---

## 🧠 Responsibilities

### 🧠 `cortex/` (framework)

* **Database engines & adapters:** provide engine-agnostic interfaces and concrete adapters (Postgres/MariaDB/SQLite).
* **Migration tooling:** `Builder`, `Blueprint`, `Runner`, `tracking`, and `discover` live here.
* **Settings & config:** load env profiles and normalize DB config for any app.
* **CLI:** expose `cx` commands used by apps.

### 🌞 `apps/*` (applications)

* **Domain logic:** services, aggregates, and use-cases specific to the app.
* **Transport:** routes/controllers (HTTP or RPC), serializers, validators.
* **State:** per‑app migrations and seeders (schema belongs to the app).
* **Docs & tests:** app-scoped documentation and test suites.

---

## ⚙️ Configuration model

* **Env profiles:** each app can supply `APP` (e.g., `cxsun`) and a `DB_*` profile. `cortex/database/getDbConfig.ts` resolves required keys per engine.
* **.env layering:** support `.env`, `.env.local`, and `.env.${NODE_ENV}`; app can add overrides under `apps/<app>/` if needed.
* **Engine selection:** `DB_ENGINE=postgres|mariadb|sqlite`. SQLite can use `DB_SQLITE_FILE` relative to repo root or absolute path.

---

## 🗺️ Migration strategy

* **Source of truth** lives in `apps/<app>/database/migration`.
* Framework supplies the runner; app supplies migration files.
* **Naming:** `YYYYMMDDHHmm__create_<table>.ts` for deterministic ordering.
* **Seeding:** keep deterministic seeds in `apps/<app>/database/seed` (idempotent, safe to re-run).

---

## 🛣️ Server boot & app mounting

* `index.ts` is the single entrypoint.
* It reads `APP=<appName>` and mounts `apps/<appName>`:

    1. Load app module (exports `manifest`, `routes`, optional `init`).
    2. Resolve DB config via `cortex` and connect.
    3. Register routes/services from the app.

---

## 🧾 Docs & naming conventions (Markdown)

* **Top-level repo docs:** `docs/architecture/01-overview.md`, `docs/architecture/02-app-structure.md`.
* **Framework docs:** `cortex/docs/01-database-engines.md`, `cortex/docs/02-migrations.md`.
* **App docs:** `apps/cxsun/docs/01-overview.md`, `apps/cxsun/docs/10-domain-model.md`, `apps/cxsun/docs/20-routes.md`.
* Use numeric prefixes (`01-`, `02-`, …) to control order; keep titles in **Title Case**.

---

## 🔢 Emoji legend

* 🧠 framework  •  🧱 apps  •  🌞 app  •  🗄️ database  •  🧭 migration  •  🌱 seed
* ⚙️ engines  •  🔌 connection  •  📦 adapters  •  🧩 building blocks  •  🛣️ routes
* 📚 docs  •  🧪 tests  •  🚀 entrypoint  •  📦 package  •  🧶 workspace  •  🔒 tsconfig  •  🧹 tools  •  🗃️ data

---

## ✅ Quick checklist

* [ ] `cortex` exports stable APIs; **no** app imports back into apps.
* [ ] Each app owns its schema (`migration/`, `seed/`).
* [ ] `index.ts` mounts chosen app via `APP` env.
* [ ] Engines + config come **only** from `cortex`.
* [ ] Docs use numeric prefixes; emoji at the **front** of names.
