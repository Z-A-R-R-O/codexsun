import { Request, Response } from "express";
import { BaseService } from "./base.service";

export abstract class BaseController<T extends { id: string }> {
    constructor(protected service: BaseService<T>) {}

    create = async (req: Request, res: Response) => {
        const created = await this.service.create(req.body);
        res.status(201).json(created);
    };

    findAll = async (_req: Request, res: Response) => {
        const items = await this.service.findAll();
        res.json(items);
    };

    findById = async (req: Request, res: Response) => {
        const item = await this.service.findById(req.params.id);
        if (!item) return res.status(404).json({ message: "Not found" });
        res.json(item);
    };

    update = async (req: Request, res: Response) => {
        const updated = await this.service.update(req.params.id, req.body);
        if (!updated) return res.status(404).json({ message: "Not found" });
        res.json(updated);
    };

    delete = async (req: Request, res: Response) => {
        const success = await this.service.delete(req.params.id);
        if (!success) return res.status(404).json({ message: "Not found" });
        res.status(204).send();
    };
}
