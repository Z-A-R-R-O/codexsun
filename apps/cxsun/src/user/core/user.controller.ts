// user.controller.ts
import { UserService } from "./user.service";
import { IRequest } from "../../../../../cortex/core/controller"; // type only

export class UserController {
    private service: UserService;

    constructor() {
        this.service = new UserService();
    }

    async Index(req: IRequest) {
        return { status: "ok", data: await this.service.findAll(req.query) };
    }

    async Show(req: IRequest) {
        const id = Number(req.params.id);
        const user = await this.service.findById(id);
        return { status: "ok", data: user };
    }

    async Store(req: IRequest) {
        const user = await this.service.create(req.body);
        return { status: "ok", data: user };
    }

    async Update(req: IRequest) {
        const id = Number(req.params.id);
        const user = await this.service.update(id, req.body);
        return { status: "ok", data: user };
    }

    async Delete(req: IRequest) {
        const id = Number(req.params.id);
        await this.service.remove(id);
        return { status: "ok", message: `User ${id} deleted` };
    }

    async Count(_req: IRequest) {
        return { status: "ok", count: await this.service.count() };
    }

    async NextNo(_req: IRequest) {
        return { status: "ok", next: await this.service.nextNo() };
    }
}
