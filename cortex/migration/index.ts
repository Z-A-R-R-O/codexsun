// Migration API (split from core DB API)
// ------------------------------------------------------------
// Exposes migration helpers and an optional CLI runner.

import type { DbConfig } from "../types";
import { db as sharedDb, createDb } from "../db/index";
import * as Migrations from "../migration_runner";
import * as Tracking from "../tracking";

export type MigrationAPI = {
    up: (dir?: string) => Promise<void>;
    down: (dir?: string) => Promise<void>;
    status: (dir?: string) => Promise<{ applied: string[]; pending: string[] }>;
    rollback: (dir?: string) => Promise<void>;
    fresh: (dir?: string) => Promise<void>;
};

async function ensure(shared = sharedDb) {
    // ensure connection & migrations table exist
    await shared.healthz();
    await Tracking.ensureMigrationsTable((shared as any).engine);
}

export const migrate: MigrationAPI = {
    up: async (dir?: string) => {
        await ensure();
        await Migrations.migrateUp((sharedDb as any).engine, { dir });
    },
    down: async (dir?: string) => {
        await ensure();
        await Migrations.migrateDown((sharedDb as any).engine, { dir });
    },
    status: async (dir?: string) => {
        await ensure();
        return Migrations.migrateStatus((sharedDb as any).engine, { dir });
    },
    rollback: async (dir?: string) => {
        await ensure();
        if ((Migrations as any).migrateRollback) {
            await (Migrations as any).migrateRollback((sharedDb as any).engine, { dir });
        } else {
            await (Migrations as any).migrateDown((sharedDb as any).engine, { dir, steps: 1 });
        }
    },
    fresh: async (dir?: string) => {
        await ensure();
        await (Migrations as any).migrateDown((sharedDb as any).engine, { dir, all: true });
        await Migrations.migrateUp((sharedDb as any).engine, { dir });
    },
};

// Optional: factory to create an isolated DB and run migrations
export async function withDbMigrations(custom?: Partial<DbConfig>) {
    const local = createDb(custom);
    await (local as any).healthz();
    await Tracking.ensureMigrationsTable((local as any).engine);
    return {
        up: (dir?: string) => Migrations.migrateUp((local as any).engine, { dir }),
        down: (dir?: string) => Migrations.migrateDown((local as any).engine, { dir }),
        status: (dir?: string) => Migrations.migrateStatus((local as any).engine, { dir }),
        rollback: (dir?: string) => (Migrations as any).migrateRollback
            ? (Migrations as any).migrateRollback((local as any).engine, { dir })
            : (Migrations as any).migrateDown((local as any).engine, { dir, steps: 1 }),
        fresh: async (dir?: string) => {
            await (Migrations as any).migrateDown((local as any).engine, { dir, all: true });
            await Migrations.migrateUp((local as any).engine, { dir });
        },
    } as MigrationAPI;
}

// -------------------- Tiny CLI (bin/migrate.ts) --------------------
// Usage examples:
//   ts-node bin/migrate.ts up
//   ts-node bin/migrate.ts down
//   ts-node bin/migrate.ts status
//   ts-node bin/migrate.ts rollback
//   ts-node bin/migrate.ts fresh
//
// Create a file: bin/migrate.ts with the following contents:
// ------------------------------------------------------------
// #!/usr/bin/env ts-node
// import { migrate } from "../migrations/index";
//
// async function main() {
//   const cmd = (process.argv[2] || "").toLowerCase();
//   const dir = process.env.MIGRATIONS_DIR; // optional
//   switch (cmd) {
//     case "up":
//       await migrate.up(dir); break;
//     case "down":
//       await migrate.down(dir); break;
//     case "status": {
//       const s = await migrate.status(dir);
//       console.log(JSON.stringify(s, null, 2));
//       break;
//     }
//     case "rollback":
//       await migrate.rollback(dir); break;
//     case "fresh":
//       await migrate.fresh(dir); break;
//     default:
//       console.error("Usage: migrate <up|down|status|rollback|fresh>");
//       process.exit(1);
//   }
// }
// main().catch((e) => { console.error(e); process.exit(1); });
// ------------------------------------------------------------
