export abstract class BaseRepository<T extends { id: string }> {
    protected items: Map<string, T> = new Map();

    async create(item: T): Promise<T> {
        this.items.set(item.id, item);
        return item;
    }

    async findById(id: string): Promise<T | null> {
        return this.items.get(id) || null;
    }

    async findAll(): Promise<T[]> {
        return Array.from(this.items.values());
    }

    async update(id: string, item: Partial<T>): Promise<T | null> {
        const existing = this.items.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...item, updatedAt: new Date() } as T;
        this.items.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        return this.items.delete(id);
    }
}
