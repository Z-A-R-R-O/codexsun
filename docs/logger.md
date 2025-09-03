import { createDbLogStore } from "./log_store";
const logStore = createDbLogStore();

const httpServer = createNodeServer(routes, {
cors: true,           // or false / options
logStore,             // <— DB writer
logger: {             // optional: still print to console as JSON
access: (rec) => console.log(JSON.stringify({ level: "access", ...rec })),
error: (e, ctx) => console.error(JSON.stringify({ level: "error", ...ctx, error: String(e?.stack || e) })),
},
});
