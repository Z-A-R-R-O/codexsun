// apps/blog/app.ts

import {FastifyInstance} from "fastify";
import registerUserApi from "./src/user/core/user.api";

export async function registerApp(fastify: FastifyInstance) {

    // Global healthy check
    fastify.get("/cxsun_hlz", async () => {
        return {status: "ok", service: "cxsun"};
    });

    await fastify.register(registerUserApi ,{prefix: "/api"}); // You can change the prefix as needed

    // You can register more APIs here in the future
}
