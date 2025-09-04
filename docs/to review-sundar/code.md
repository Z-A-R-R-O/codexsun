```
import tenantApi from "./core/tenant/tenant.api";
import {FastifyInstance} from "fastify";

async function buildApp(fastify: FastifyInstance) {
// other APIs…
fastify.register(tenantApi);
}
```

````
// apps/tenant.api.ts
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import tenantController from "./tenant.controller";

const tenantApi: FastifyPluginAsync = async (fastify: FastifyInstance) => {
    // All tenant routes live under /tenants
    fastify.register(tenantController, { prefix: "api/tenant" });
};

export default tenantApi;


````