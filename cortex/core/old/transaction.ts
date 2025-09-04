// transaction.ts — Transaction wrapper for Models
import { queryAdapter } from "./queryAdapter";

export class Transaction {
    private active = false;
    private conn: any;

    async begin(): Promise<void> {
        if (this.active) throw new Error("Transaction already active");
        this.conn = await queryAdapter.getConnection();
        await this.conn.beginTransaction();
        this.active = true;
    }

    async commit(): Promise<void> {
        if (!this.active) throw new Error("No active transaction");
        await this.conn.commit();
        await this.conn.release();
        this.active = false;
    }

    async rollback(): Promise<void> {
        if (!this.active) throw new Error("No active transaction");
        await this.conn.rollback();
        await this.conn.release();
        this.active = false;
    }

    getConnection() {
        if (!this.active) throw new Error("No active transaction");
        return this.conn;
    }
}

/* ──────────────────────────────
 * Helper function
 * ────────────────────────────── */
export async function withTransaction<T>(
    fn: (tx: Transaction) => Promise<T>
): Promise<T> {
    const tx = new Transaction();
    await tx.begin();
    try {
        const result = await fn(tx);
        await tx.commit();
        return result;
    } catch (err) {
        await tx.rollback();
        throw err;
    }
}
