// // apps/blog/core/tenant/tenant.api.ts
// import { FastifyInstance } from "fastify";
//
// interface Tenant {
//     id: number;
//     name: string;
// }
//
// let tenants: Tenant[] = [
//     { id: 1, name: "Tenant A" },
//     { id: 2, name: "Tenant B" },
// ];
//
// export default async function tenantdApi(fastify: FastifyInstance) {
//     // List
//     fastify.get("/", async () => tenants);
//
//     // Get by ID
//     fastify.get("/:id", async (req, reply) => {
//         const { id } = req.params as { id: string };
//         const tenant = tenants.find((t) => t.id === Number(id));
//         if (!tenant) return reply.code(404).send({ error: "Not found" });
//         return tenant;
//     });
//
//     // Create
//     fastify.post("/", async (req, reply) => {
//         const body = req.body as { name: string };
//         const tenant: Tenant = { id: tenants.length + 1, name: body.name };
//         tenants.push(tenant);
//         return tenant;
//     });
//
//     // Update
//     fastify.put("/:id", async (req, reply) => {
//         const { id } = req.params as { id: string };
//         const body = req.body as { name: string };
//         const tenant = tenants.find((t) => t.id === Number(id));
//         if (!tenant) return reply.code(404).send({ error: "Not found" });
//         tenant.name = body.name;
//         return tenant;
//     });
//
//     // Delete
//     fastify.delete("/:id", async (req, reply) => {
//         const { id } = req.params as { id: string };
//         tenants = tenants.filter((t) => t.id !== Number(id));
//         return { success: true };
//     });
// }
