// ===================================== app/user/User.controller.ts =====================================
import type { FastifyRequest, FastifyReply } from "fastify";
import { UserRepo } from "./user.repo";
import {
    validateCreate,
    validateQuery,
    validateUpdate,
} from "./user.validator";

export class UserController {
    constructor(private readonly repo: UserRepo) {}

    ensureSchema = async (_req: FastifyRequest, reply: FastifyReply) => {
        try {
            await this.repo.ensureTable();
            return reply.code(200).send({ ok: true });
        } catch (err) {
            console.error("[UserController.ensureSchema] error:", err);
            return reply.code(500).send({ error: String(err) });
        }
    };

    create = async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const input = validateCreate(req);
            const user = await this.repo.create(input);
            return reply.code(201).send(user);
        } catch (err) {
            console.error("[UserController.create] error:", err);
            return reply.code(500).send({ error: String(err) });
        }
    };

    get = async (req: FastifyRequest, reply: FastifyReply) => {
        const id = Number((req.params as any).id);
        const user = await this.repo.findById(id);
        if (!user) return reply.code(404).send({ error: "User not found" });
        return reply.send(user);
    };

    list = async (req: FastifyRequest, reply: FastifyReply) => {
        const q = validateQuery(req);
        const limit = q.limit ?? 100;
        const offset = q.offset ?? 0;

        const users = await this.repo.findAll(limit, offset);
        return reply.send(users);
    };

    update = async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const input = validateUpdate(req);
            const user = await this.repo.update(input.id, input);
            return reply.send(user);
        } catch (err) {
            console.error("[UserController.update] error:", err);
            return reply.code(500).send({ error: String(err) });
        }
    };

    remove = async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const id = Number((req.params as any).id);
            await this.repo.remove(id);
            return reply.code(204).send();
        } catch (err) {
            console.error("[UserController.remove] error:", err);
            return reply.code(500).send({ error: String(err) });
        }
    };
}
