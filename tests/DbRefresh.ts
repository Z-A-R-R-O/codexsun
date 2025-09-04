// DbRefresh.ts — Reset database for tests/dev
import { mdb } from "../cortex/database/db";

export class DbRefresh {
    /* ───────────────
     * Truncate tables (clear only)
     * ─────────────── */
    static async truncate() {
        const tables = [
            "audit_logs",
            "tenants",
            // add more core tables here (plans, features, subscriptions...)
        ];

        for (const table of tables) {
            try {
                await mdb.query(`DELETE FROM ${table}`);
            } catch (err) {
                console.warn(`⚠️ Could not truncate ${table}:`, err);
            }
        }
    }

    /* ───────────────
     * Seed default data
     * ─────────────── */
    static async seed() {
        await mdb.query(
            `INSERT INTO tenants (id, name, email) VALUES (?, ?, ?)` ,
            ["seed-tenant", "Seed Tenant", "seed@example.com"]
        );
    }

    /* ───────────────
     * Refresh = truncate + seed
     * ─────────────── */
    static async refresh() {
        await DbRefresh.truncate();
        await DbRefresh.seed();
    }

    /* ───────────────
     * Reset DB before each test case
     * ─────────────── */
    static async reset() {
        await DbRefresh.refresh();
    }
}