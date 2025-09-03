// cortex/core/service.ts

// Instance interface your data layer must implement
export interface ModelApi<T> {
    findAll(opts: {
        filters?: Record<string, any>;
        sort?: string;
        order?: "asc" | "desc";
        limit?: number;
        offset?: number;
    }): Promise<T[]>;
    count(opts?: { filters?: Record<string, any> }): Promise<number>;
    findById(id: number): Promise<T | null>;
    create(data: any): Promise<T>;
    update(id: number, data: any): Promise<T>;
    remove(id: number): Promise<void>;
    nextSequence(): Promise<number>;
}

// Core pagination (single source of truth)
export interface PaginatedMeta {
    total: number;
    limit: number;
    offset: number;
    sort?: string;
    order?: "asc" | "desc";
    filters?: Record<string, any>;
}
export interface PaginatedResult<T> {
    status: "success" | "error";
    data: T[];
    meta: PaginatedMeta;
}

// Generic base Service works with any ModelApi<T> instance
export abstract class Service<M extends ModelApi<any>, DTO> {
    protected model: M;
    protected name: string;

    constructor(model: M, name?: string) {
        this.model = model;
        this.name = name ?? (model as any).constructor?.name ?? "Unknown";
    }

    // Subclasses map entities to DTOs
    protected abstract toDTO(entity: any): DTO;
    protected abstract toDTOList(entities: any[]): DTO[];

    // Optional validator hooks
    protected validateCreate?(data: any): any;
    protected validateUpdate?(data: any): any;

    async findAll(query: any): Promise<PaginatedResult<DTO>> {
        const {
            sort = "id",
            order = "asc",
            limit = 100,
            offset = 0,
            ...filters
        } = query;

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

    async findByIdOrFail(id: number): Promise<DTO> {
        const row = await this.model.findById(id);
        if (!row) throw new Error(`${this.name} not found`);
        return this.toDTO(row);
    }

    async create(data: any): Promise<DTO> {
        const input = this.validateCreate ? this.validateCreate(data) : data;
        const row = await this.model.create(input);
        return this.toDTO(row);
    }

    async update(id: number, data: any): Promise<DTO> {
        const input = this.validateUpdate ? this.validateUpdate(data) : data;
        const row = await this.model.update(id, input);
        return this.toDTO(row);
    }

    async remove(id: number): Promise<void> {
        await this.model.remove(id);
    }

    async count(filters: Record<string, any> = {}): Promise<number> {
        return this.model.count({ filters });
    }

    async nextSequence(): Promise<number> {
        return this.model.nextSequence();
    }
}
