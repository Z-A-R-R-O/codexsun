import { User } from "./user.model";
import { getConnection } from "../../../../../../cortex/database/connection_manager";

export class UserRepo {
    private connPromise = getConnection("default");

    private async conn() {
        return await this.connPromise; // resolves to sqlite_engine (or maria/postgres engine)
    }

    async all(limit = 100, offset = 0): Promise<User[]> {
        const conn = await this.conn();
        const result = await conn.query<User>(
            "SELECT * FROM users LIMIT ? OFFSET ?",
            [limit, offset]
        );
        return result.rows.map(row => new User(row));
    }

    async byId(id: number): Promise<User | null> {
        const conn = await this.conn();
        const result = await conn.query<User>(
            "SELECT * FROM users WHERE id = ?",
            [id]
        );
        return result.rows[0] ? new User(result.rows[0]) : null;
    }

    async insert(user: Partial<User>): Promise<User> {
        const conn = await this.conn();
        const result = await conn.query(
            "INSERT INTO users (name, email, password, is_active) VALUES (?, ?, ?, ?)",
            [user.name, user.email, user.password, user.is_active ?? 1]
        );
        const id = (result as any).lastID ?? (result as any).insertId;
        return new User({
            id,
            name: user.name!,
            email: user.email!,
            password: user.password!,
            is_active: user.is_active ?? true,
            created_at: new Date(),
            updated_at: new Date(),
        });
    }

    async update(id: number, patch: Partial<User>): Promise<User | null> {
        const conn = await this.conn();
        await conn.query(
            "UPDATE users SET name = ?, email = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [patch.name, patch.email, patch.is_active ?? 1, id]
        );
        return this.byId(id);
    }

    async remove(id: number): Promise<boolean> {
        const conn = await this.conn();
        await conn.query("DELETE FROM users WHERE id = ?", [id]);
        return true;
    }

    async count(): Promise<number> {
        const conn = await this.conn();
        const result = await conn.query<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM users"
        );
        return result.rows[0]?.cnt ?? 0;
    }

    async nextNo(): Promise<number> {
        const conn = await this.conn();
        const result = await conn.query<{ next: number }>(
            "SELECT MAX(id) + 1 as next FROM users"
        );
        return result.rows[0]?.next ?? 1;
    }
}
