// apps/cxsun/src/user/user.service.ts
import { User } from "./user.model";
import { UserValidator } from "./user.validator";
import { UserRepo } from "./user.repo";

export class UserService {
    private validator = new UserValidator();
    private repo = new UserRepo();

    async findAll(opts?: { limit?: number; offset?: number }): Promise<User[]> {
        return this.repo.all(opts?.limit, opts?.offset);
    }

    async findById(id: number): Promise<User | null> {
        return this.repo.byId(id);
    }

    async create(data: Partial<User>): Promise<User> {
        const valid = this.validator.validateCreate(data);
        const user = new User({
            id: await this.repo.nextNo(),
            created_at: new Date(),
            updated_at: new Date(),
            ...valid,
        });
        return this.repo.insert(user);
    }

    async update(id: number, data: Partial<User>): Promise<User | null> {
        const valid = this.validator.validateUpdate(data);
        return this.repo.update(id, valid);
    }

    async remove(id: number): Promise<{ id: number }> {
        await this.repo.remove(id);
        return { id };
    }

    async count(): Promise<number> {
        return this.repo.count();
    }

    async nextNo(): Promise<number> {
        return this.repo.nextNo();
    }
}
