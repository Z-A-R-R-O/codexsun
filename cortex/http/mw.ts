// cortex/http/mw.ts
export type Handler = (req: any, res: any) => Promise<void> | void;

export const compose =
    (...fns: Handler[]) =>
        async (req: any, res: any) => {
            for (const fn of fns) await fn(req, res);
        };

// no-op placeholders; wire your existing middlewares here if needed
export const withLogger: Handler = async () => {};
export const withTiming: Handler = async () => {};
