// cortex/config.ts
export function appName() { return process.env.APP_NAME || "CodexSun"; }
export function appVersion() { return process.env.APP_VERSION || "1.0.0"; }
export function appDebug() { return /^(1|true|yes|on)$/i.test(process.env.APP_DEBUG || ""); }

export function appHost() { return process.env.APP_HOST || process.env.HOST || "localhost"; }
export function appPort() {
    const n = parseInt(process.env.APP_PORT || process.env.PORT || "3006", 10);
    return Number.isFinite(n) ? n : 3006;
}
