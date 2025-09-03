export class ORM {
    insert(table: string, data: Record<string, any>) {
        return `INSERT INTO ${table} (${Object.keys(data).join(", ")}) VALUES (${Object.values(data).map(() => "?").join(", ")})`;
    }

    update(table: string, data: Record<string, any>, where: string) {
        return `UPDATE ${table} SET ${Object.keys(data).map(k => `${k} = ?`).join(", ")} WHERE ${where}`;
    }

    delete(table: string, where: string) {
        return `DELETE FROM ${table} WHERE ${where}`;
    }

    select(table: string, where?: string) {
        return `SELECT * FROM ${table}${where ? " WHERE " + where : ""}`;
    }
}
