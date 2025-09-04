// cortex/http/parse.ts
export const getQuery = (req: any) => (req?.query ?? {});
export const getPathParams = (req: any) => (req?.params ?? {});
export const getBody = async (req: any) => (req?.body ?? undefined);
