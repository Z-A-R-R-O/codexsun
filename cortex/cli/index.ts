#!/usr/bin/env ts-node

// cortex/cli/index.ts
import "dotenv/config";
import {showBootUsage} from "./doctor/boot-help";
import {runMigrations} from "../migration/Runner";
import {showMigrationRunnerUsage} from "./migration/runner-help";
import {pathToFileURL} from "url";
import {runFixFilenames} from "./filename/fix-filenames";
import {showFilenamesUsage} from "./filename/filenames-help";
import {RouteRegistry} from "../http/route_registry";

type Action = "up" | "down" | "refresh" | "fresh";

type FlagValue = string | number | boolean;
type Flags = Record<string, FlagValue>;

function coerce(v: string | undefined): FlagValue {
    if (v === undefined) return true;                    // --flag
    const lower = v.toLowerCase();
    if (lower === "true") return true;                   // --flag=true
    if (lower === "false") return false;                 // --flag=false
    if (/^-?\d+$/.test(v)) return Number(v);             // --n=3
    return v;                                            // string fallback
}

function parseFlags(argv: string[]): Flags {
    const flags: Flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;

        // support --no-print
        if (a === "--no-print") {
            flags.print = false;
            continue;
        }

        // support --key=value
        if (a.includes("=")) {
            const [k, v] = a.slice(2).split("=");
            flags[k] = coerce(v);
            continue;
        }

        // support space-separated: --key value
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
            flags[k] = coerce(next);
            i++; // consume value
        } else {
            flags[k] = true; // bare boolean flag
        }
    }
    return flags;
}

/** Exported entry so other modules can invoke the CLI programmatically. */
export async function runCli(args?: string[], registry?: RouteRegistry) {
    void registry; // keep param referenced to avoid TS6133
    const argv = args ?? process.argv.slice(2);

    if (argv.length === 0) {
        showBootUsage();
        console.error("\nTip: run `pnpm cx migration up` to apply pending migrations.");
        process.exit(1);
    }

    const [cmd, sub, ...rest] = argv;

    if (cmd === "migrate") {
        const allowed: Action[] = ["up", "down", "refresh", "fresh"];
        if (!sub || !allowed.includes(sub as Action)) {
            showMigrationRunnerUsage();
            process.exit(1);
        }

        const flags = parseFlags(rest);

        // Build a typed options object for runMigrations (expects a single param)
        const profile =
            (flags.profile as string) ?? process.env.DB_PROFILE ?? "default";

        let steps: number | undefined;
        if (flags.steps !== undefined) {
            const n = Number(flags.steps);
            if (!Number.isNaN(n)) steps = n;
        }

        const print = flags.print === undefined ? true : Boolean(flags.print);

        await runMigrations({
            action: sub as Action,
            profile,
            steps,
            print,
        });

        process.exit(0);
    }


    if (cmd === "filenames") {
        const [sub, folder, ...rest] = argv.slice(1);

        if (!sub) {
            showFilenamesUsage();
            process.exit(1);
        }

        if (sub === "scan" || sub === "fix") {
            const args: string[] = [sub, ...rest];
            if (folder) args.unshift(folder); // allow folder path
            await runFixFilenames(args);
            process.exit(0);
        }

        console.error(`Unknown filenames command: ${sub}`);
        showFilenamesUsage();
        process.exit(1);
    }


    // unknown command
    console.error(`Unknown command: ${cmd}`);
    showBootUsage();
    process.exit(1);
}

/** ESM + CJS safe "main module" check */
function isDirectExecution(): boolean {
    // ESM path: compare current module URL to argv[1]
    try {
        if (typeof import.meta !== "undefined" && (import.meta as any).url) {
            const current = (import.meta as any).url as string;
            const invoked = pathToFileURL(process.argv[1]!).href;
            if (current === invoked) return true;
        }
    } catch {
        // ignore
    }

    // CJS path: require.main === module (only if require/module exist)
    // Using typeof avoids ReferenceError in ESM
    // @ts-ignore
    if (typeof require !== "undefined" && typeof module !== "undefined") {
        // @ts-ignore
        return require.main === module;
    }

    return false;
}

if (isDirectExecution()) {
    runCli().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
