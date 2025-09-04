import { BaseRepository } from "./base.repo";

export abstract class BaseService<T extends { id: string }> {
    constructor(protected repo: BaseRepository<T>) {}

    create(item: T): Promise<T> {
        return this.repo.create(item);
    }

    findById(id: string): Promise<T | null> {
        return this.repo.findById(id);
    }

    findAll(): Promise<T[]> {
        return this.repo.findAll();
    }

    update(id: string, item: Partial<T>): Promise<T | null> {
        return this.repo.update(id, item);
    }

    delete(id: string): Promise<boolean> {
        return this.repo.delete(id);
    }
}
