import { FastifyPluginCallback, FastifyRequest } from "fastify";
import { UserController } from "./user.controller";
import { aRequest } from "../../../../../../cortex/core/old/controller";
import { IRequest } from "../../../../../../cortex/core/old/controller";

const registerUserApi: FastifyPluginCallback<{ prefix?: string }> = (app, _opts, done) => {
    const ctrl = new UserController();
    const base = "/users";


    app.get(`${base}/z`, async (_req, reply) => {
        reply.send({ status: "ok", service: "users api is working" });
    });

    app.get(base, async (req: FastifyRequest, reply) => {
        const areq: IRequest = aRequest.fromFastify(req);
        const res = await ctrl.Index(areq);
        reply.send(res);
    });

    app.get(`${base}/count`, async (req: FastifyRequest, reply) => {
        const res = await ctrl.Count(aRequest.fromFastify(req));
        reply.send(res);
    });

    app.get(`${base}/nextno`, async (req: FastifyRequest, reply) => {
        const res = await ctrl.NextNo(aRequest.fromFastify(req));
        reply.send(res);
    });

    app.get(`${base}/:id`, async (req: FastifyRequest, reply) => {
        const res = await ctrl.Show(aRequest.fromFastify(req));
        reply.send(res);
    });

    app.post(base, async (req: FastifyRequest, reply) => {
        const res = await ctrl.Store(aRequest.fromFastify(req));
        reply.send(res);
    });

    app.put(`${base}/:id`, async (req: FastifyRequest, reply) => {
        const res = await ctrl.Update(aRequest.fromFastify(req));
        reply.send(res);
    });

    app.delete(`${base}/:id`, async (req: FastifyRequest, reply) => {
        const res = await ctrl.Delete(aRequest.fromFastify(req));
        reply.send(res);
    });

    done();
};

export default registerUserApi;
export { registerUserApi };
