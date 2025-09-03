import Fastify from "fastify";
import { UserRepo } from "../../tenant/temp/code/user.repo";
import { UserController } from "../../tenant/temp/code/user.controller";
import sqlite3pkg from "sqlite3";
import chalk from "chalk";
import { InMemorySqliteConnection } from "../../../../../cortex/database/contracts/InMemorySqliteConnection";

const sqlite3 = sqlite3pkg.verbose();

const Loops = 10; // how many loops of the main test sequence
const UsersPerLoop = 20; // how many users to create per loop

export async function userIntegrationTests() {
    const fastify = Fastify({ logger: false });
    const conn = new InMemorySqliteConnection();
    const repo = new UserRepo(conn);
    const ctl = new UserController(repo);

    await repo.dropTable();
    await repo.ensureTable();

    fastify.get("/api/user/ensure-schema", ctl.ensureSchema);
    fastify.get("/api/user/:id", ctl.get);
    fastify.get("/api/user", ctl.list);
    fastify.post("/api/user", ctl.create);
    fastify.put("/api/user", ctl.update);
    fastify.delete("/api/user/:id", ctl.remove);

    const start = Date.now();
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;

    async function createUser(name: string) {
        const res = await fastify.inject({
            method: "POST",
            url: "/api/user",
            payload: {
                name,
                email: `${name.toLowerCase()}@example.com`,
                password: "secret123",
                is_active: 1,
            },
        });
        if (res.statusCode !== 201) throw new Error("create failed");
        totalInserted++;
        return res.json();
    }

    async function updateUser(id: number, newName: string) {
        const res = await fastify.inject({
            method: "PUT",
            url: "/api/user",
            payload: { id, name: newName, is_active: 1 },
        });
        if (res.statusCode !== 200) throw new Error("update failed");
        totalUpdated++;
        return res.json();
    }

    async function deleteUser(id: number) {
        const res = await fastify.inject({
            method: "DELETE",
            url: `/api/user/${id}`,
        });
        if (res.statusCode !== 204) throw new Error("delete failed");
        totalDeleted++;
    }

    async function listUsers() {
        const res = await fastify.inject({
            method: "GET",
            url: "/api/user?limit=1000",
        });
        if (res.statusCode !== 200) throw new Error("list failed");
        return res.json();
    }

    console.log(chalk.yellow("\n=== Running Loop Tests ==="));

    for (let i = 1; i <= Loops; i++) {
        console.log(chalk.cyan(`\n--- Iteration ${i} ---`));

        // add UsersPerLoop users
        const created: any[] = [];
        for (let j = 1; j <= UsersPerLoop; j++) {
            const u = await createUser(`User_${i}_${j}`);
            console.log(chalk.green(`✔ created ${u.name}`));
            created.push(u);
        }

        // update first 2
        for (let j = 0; j < 2 && j < created.length; j++) {
            const u = await updateUser(created[j].id, `${created[j].name}_upd`);
            console.log(chalk.green(`✔ updated ${u.name}`));
        }

        // delete last 1
        if (created.length) {
            await deleteUser(created[created.length - 1].id);
            console.log(chalk.green(`✔ deleted user ${created[created.length - 1].id}`));
        }

        // bulk insert 10
        for (let j = 1; j <= 10; j++) {
            await createUser(`Bulk_${i}_${j}`);
        }
        console.log(chalk.green(`✔ bulk inserted 10 users`));

        // list
        const all = await listUsers();
        console.log(chalk.green(`✔ listed ${all.length} users`));

        // add 2 more
        for (let j = 1; j <= 2; j++) {
            await createUser(`Extra_${i}_${j}`);
        }
        console.log(chalk.green(`✔ added 2 extra users`));

        // edit 3
        const snapshot = await listUsers();
        for (let j = 0; j < 3 && j < snapshot.length; j++) {
            await updateUser(snapshot[j].id, `${snapshot[j].name}_edited`);
        }
        console.log(chalk.green(`✔ edited 3 users`));
    }

    const end = Date.now();
    const duration = ((end - start) / 1000).toFixed(2);

    console.log(chalk.bold("\n=== Test Summary ==="));
    console.log(`loops    : ${Loops}`);
    console.log(`inserted : ${chalk.green(totalInserted)}`);
    console.log(`updated  : ${chalk.green(totalUpdated)}`);
    console.log(`deleted  : ${chalk.green(totalDeleted)}`);
    console.log(`duration : ${chalk.blueBright(duration + " s")}`);

    await conn.end();
    await fastify.close();
    return true;
}
