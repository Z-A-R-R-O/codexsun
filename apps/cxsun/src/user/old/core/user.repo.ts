// apps/cxsun/src/user/user.repo.ts
import { User } from "./user.model";
import { getConnection } from "../../../../../../cortex/database/connection_manager";

export class UserRepo {
    private conn = getConnection("default"); // live DB connection

    async all(limit = 100, offset = 0): Promise<User[]> {
        const result = await this.conn.excute<User>(
            "SELECT * FROM users LIMIT ? OFFSET ?",
            [limit, offset]
        );
        return result.rows.map(row => new User(row));
    }

    async byId(id: number): Promise<User | null> {
        const result = await this.conn.query<User>(
            "SELECT * FROM users WHERE id = ?",
            [id]
        );
        return result.rows[0] ? new User(result.rows[0]) : null;
    }

    async insert(user: Partial<User>): Promise<User> {
        const result = await this.conn.query(
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
        await this.conn.query(
            "UPDATE users SET name = ?, email = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [patch.name, patch.email, patch.is_active ?? 1, id]
        );
        return this.byId(id);
    }

    async remove(id: number): Promise<boolean> {
        await this.conn.query("DELETE FROM users WHERE id = ?", [id]);
        return true;
    }

    async count(): Promise<number> {
        const result = await this.conn.query<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM users"
        );
        return result.rows[0]?.cnt ?? 0;
    }

    async nextNo(): Promise<number> {
        const result = await this.conn.query<{ next: number }>(
            "SELECT MAX(id) + 1 as next FROM users"
        );
        return result.rows[0]?.next ?? 1;
    }
}
