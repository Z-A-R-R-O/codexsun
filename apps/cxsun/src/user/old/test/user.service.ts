// apps/cxsun/src/user/user.service.ts
import { Service, ModelApi, PaginatedResult } from "../../../../../../cortex/core/old/service";
import { User } from "./user.model";
import { UserValidator } from "./user.validator";

export interface UserDTO {
    id: number;
    name: string;
    email: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

/**
 * Tiny adapter that presents your User model as a ModelApi<UserEntity>.
 * It delegates to whatever your model actually exposes (static or instance).
 * If your base Model has these methods but TypeScript doesn't know, we cast to any.
 */
class UserModelApi implements ModelApi<any> {
    private Model: any;   // class or repo
    private inst: any;    // optional instance (if needed)

    constructor(ModelClass: any) {
        this.Model = ModelClass;
        this.inst = typeof ModelClass === "function" ? new ModelClass() : ModelClass;
    }

    findAll(opts: any)     { return (this.Model.findAll ?? this.inst.findAll).call(this.Model ?? this.inst, opts); }
    count(opts?: any)      { return (this.Model.count ?? this.inst.count).call(this.Model ?? this.inst, opts); }
    findById(id: number)   { return (this.Model.findById ?? this.inst.findById).call(this.Model ?? this.inst, id); }
    create(data: any)      { return (this.Model.create ?? this.inst.create).call(this.Model ?? this.inst, data); }
    update(id: number, d: any) { return (this.Model.update ?? this.inst.update).call(this.Model ?? this.inst, id, d); }
    remove(id: number)     { return (this.Model.remove ?? this.inst.remove).call(this.Model ?? this.inst, id); }
    nextSequence()         { return (this.Model.nextSequence ?? this.inst.nextSequence).call(this.Model ?? this.inst); }
}

export class UserServidced extends Service<UserModelApi, UserDTO> {
    constructor() {
        // Pass the adapter instance; name is just for error messages
        super(new UserModelApi(User), "User");
    }

    // --- DTO Mappers ---
    protected toDTO(user: any): UserDTO {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            is_active: user.is_active ?? true,
            created_at: new Date(user.created_at ?? new Date()).toISOString(),
            updated_at: new Date(user.updated_at ?? new Date()).toISOString(),
        };
    }

    protected toDTOList(users: any[]): UserDTO[] {
        return users.map((u) => this.toDTO(u));
    }

    // --- Validators (hook into base create/update) ---
    protected validateCreate(data: any) {
        return new UserValidator().validateCreate(data);
    }

    protected validateUpdate(data: any) {
        return new UserValidator().validateUpdate(data);
    }

    // (Optional) keep your custom filter shape while preserving core types
    async findAll(query: any): Promise<PaginatedResult<UserDTO>> {
        const {
            name,
            email,
            is_active,
            sort = "id",
            order = "asc",
            limit = 100,
            offset = 0,
            ...rest
        } = query;

        const filters: Record<string, any> = { ...rest };
        if (name) filters.name = name;
        if (email) filters.email = email;
        if (is_active !== undefined) filters.is_active = is_active;

        const ord: "asc" | "desc" =
            String(order).toLowerCase() === "desc" ? "desc" : "asc";

        const rows = await this.model.findAll({
            filters,
            sort,
            order: ord,
            limit: +limit,
            offset: +offset,
        });
        const total = await this.model.count({ filters });

        return {
            status: "success",
            data: this.toDTOList(rows),
            meta: { total, limit: +limit, offset: +offset, sort, order: ord, filters },
        };
    }
}
