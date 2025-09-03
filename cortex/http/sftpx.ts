// cortex/framework/sftpx.ts
// Lightweight SFTP server wrapper (optional). Uses `ssh2` if available.
// Exports `createSftpServer({ rootDir, hostKeyPath, users })` which returns an object with `.listen(port, host, cb)`.
//
// Notes:
// - Auth: either password or public key (OpenSSH format). Provide per-user via `users`.
// - Filesystem: jailed to `rootDir` (path escaping is blocked).
// - If `ssh2` is not installed, a no-op stub is returned so your app won’t crash.

import fs from "fs";
import path from "path";

export type SftpUser = {
    username: string;
    password?: string;
    authorizedKeys?: string[]; // OpenSSH public keys
};

export interface SftpOptions {
    rootDir: string;
    hostKeyPath?: string; // required if ssh2 present
    users?: SftpUser[];
}

type ListenCb = () => void;

function safeJoin(root: string, p: string) {
    const norm = path.resolve(root, p.replace(/^\/+/, ""));
    const rootAbs = path.resolve(root);
    if (!norm.startsWith(rootAbs)) {
        throw Object.assign(new Error("Path escapes root"), { code: "EPERM" });
    }
    return norm;
}

function fileAttrsFromStat(st: fs.Stats) {
    // See ssh2-streams attrs: size, uid, gid, mode, atime, mtime
    return {
        mode: st.mode,
        uid: (st as any).uid ?? 0,
        gid: (st as any).gid ?? 0,
        size: Number(st.size),
        atime: Math.floor(st.atimeMs / 1000) || Math.floor(st.atime.getTime() / 1000),
        mtime: Math.floor(st.mtimeMs / 1000) || Math.floor(st.mtime.getTime() / 1000),
    };
}

function loadHostKey(hostKeyPath?: string): Buffer | null {
    if (!hostKeyPath) return null;
    const p = path.resolve(hostKeyPath);
    if (!fs.existsSync(p)) throw new Error(`SFTP host key not found at ${p}`);
    return fs.readFileSync(p);
}

function parseAuthorizedKeys(keys?: string[]): any[] {
    // Lazy parse at runtime if ssh2 present
    return keys?.filter(Boolean) ?? [];
}

export function createSftpServer(opts: SftpOptions) {
    let SSH2: any = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        SSH2 = require("ssh2");
    } catch {
        SSH2 = null;
    }

    const rootDir = path.resolve(opts.rootDir || path.resolve(process.cwd(), "storage", "sftp"));
    fs.mkdirSync(rootDir, { recursive: true });

    if (!SSH2) {
        // Graceful stub: does nothing but logs a warning
        return {
            listen(_port: number, _host?: string, cb?: ListenCb) {
                console.warn("[SFTP] ssh2 module not installed — SFTP server disabled");
                cb && cb();
                return {
                    close() {/* noop */},
                };
            },
        };
    }

    const hostKey = loadHostKey(opts.hostKeyPath);
    const users = (opts.users || []).map((u) => ({
        username: u.username,
        password: u.password,
        authorizedKeys: parseAuthorizedKeys(u.authorizedKeys),
    }));

    const server = new SSH2.Server(
        { hostKeys: hostKey ? [hostKey] : undefined },
        (client: any) => {
            let authedUser: SftpUser | null = null;

            client.on("authentication", (ctx: any) => {
                const u = users.find((x) => x.username === ctx.username);

                // No user configured -> reject
                if (!u) return ctx.reject();

                // password
                if (ctx.method === "password" && u.password) {
                    if (ctx.password === u.password) {
                        authedUser = u;
                        return ctx.accept();
                    }
                    return ctx.reject();
                }

                // publickey
                if (ctx.method === "publickey" && Array.isArray(u.authorizedKeys) && u.authorizedKeys.length) {
                    try {
                        const { utils } = SSH2;
                        const match = u.authorizedKeys.some((keyStr: string) => {
                            try {
                                const parsed = utils.parseKey(keyStr.trim());
                                // ctx.key.algo && ctx.key.data are provided
                                return (
                                    parsed &&
                                    parsed.type === ctx.key.algo &&
                                    parsed.getPublicSSH() &&
                                    Buffer.isBuffer(ctx.key.data) &&
                                    Buffer.compare(parsed.getPublicSSH(), ctx.key.data) === 0
                                );
                            } catch {
                                return false;
                            }
                        });
                        if (match) {
                            authedUser = u;
                            return ctx.accept();
                        }
                    } catch (e) {
                        // fallthrough
                    }
                    return ctx.reject();
                }

                // If user has no creds configured, reject
                return ctx.reject();
            });

            client.on("ready", () => {
                client.on("session", (accept: any, _reject: any) => {
                    const session = accept();
                    session.on("sftp", (acceptSftp: any, _rejectSftp: any) => {
                        const sftp = acceptSftp();

                        // handle registry
                        const fds = new Map<number, number>(); // handleId -> fd
                        const dds = new Map<number, fs.Dir>(); // handleId -> Dir
                        let nextHandle = 1;

                        const makeHandle = () => {
                            const id = nextHandle++;
                            const buf = Buffer.alloc(4);
                            buf.writeUInt32BE(id, 0);
                            return { id, buf };
                        };

                        sftp.on("REALPATH", (reqid: number, givenPath: string) => {
                            try {
                                const abs = safeJoin(rootDir, givenPath || ".");
                                const rel = "/" + path.relative(rootDir, abs).replace(/\\/g, "/");
                                sftp.name(reqid, [{ filename: rel || "/", longname: rel, attrs: {} }]);
                            } catch (e) {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("STAT", (reqid: number, p: string) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                const st = fs.statSync(abs);
                                sftp.attrs(reqid, fileAttrsFromStat(st));
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.NO_SUCH_FILE);
                            }
                        });

                        sftp.on("LSTAT", (reqid: number, p: string) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                const st = fs.lstatSync(abs);
                                sftp.attrs(reqid, fileAttrsFromStat(st));
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.NO_SUCH_FILE);
                            }
                        });

                        sftp.on("FSTAT", (reqid: number, handle: Buffer) => {
                            const id = handle.readUInt32BE(0);
                            const fd = fds.get(id);
                            if (!fd) return sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            try {
                                const st = fs.fstatSync(fd);
                                sftp.attrs(reqid, fileAttrsFromStat(st));
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("OPENDIR", (reqid: number, p: string) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                const dir = fs.opendirSync(abs);
                                const h = makeHandle();
                                dds.set(h.id, dir);
                                sftp.handle(reqid, h.buf);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("READDIR", (reqid: number, handle: Buffer) => {
                            const id = handle.readUInt32BE(0);
                            const dir = dds.get(id);
                            if (!dir) return sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);

                            try {
                                const entries: any[] = [];
                                for (let i = 0; i < 64; i++) {
                                    const dirent = dir.readSync();
                                    if (!dirent) break;
                                    const full = path.join(dir.path, dirent.name);
                                    let st: fs.Stats | null = null;
                                    try { st = fs.lstatSync(full); } catch { st = null; }
                                    entries.push({
                                        filename: dirent.name,
                                        longname: dirent.name,
                                        attrs: st ? fileAttrsFromStat(st) : {},
                                    });
                                }
                                if (entries.length) {
                                    sftp.name(reqid, entries);
                                } else {
                                    // end of directory
                                    dir.closeSync();
                                    dds.delete(id);
                                    sftp.status(reqid, SSH2.SFTP_STATUS_CODE.EOF);
                                }
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("CLOSE", (reqid: number, handle: Buffer) => {
                            const id = handle.readUInt32BE(0);
                            const fd = fds.get(id);
                            const dir = dds.get(id);
                            try {
                                if (fd != null) {
                                    fs.closeSync(fd);
                                    fds.delete(id);
                                }
                                if (dir) {
                                    dir.closeSync();
                                    dds.delete(id);
                                }
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("OPEN", (reqid: number, p: string, flags: number, _attrs: any) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                // Convert SFTP flags to fs flags
                                // Basic mapping; adjust as needed
                                const O_RDONLY = 0x00; const O_WRONLY = 0x01; const O_RDWR = 0x02;
                                const O_CREAT = 0x040; const O_TRUNC = 0x200; const O_EXCL = 0x080;
                                let fsFlags = 0;
                                if (flags & O_RDWR) fsFlags = fsFlags | fs.constants.O_RDWR;
                                else if (flags & O_WRONLY) fsFlags = fsFlags | fs.constants.O_WRONLY;
                                else fsFlags = fsFlags | fs.constants.O_RDONLY;
                                if (flags & O_CREAT) fsFlags = fsFlags | fs.constants.O_CREAT;
                                if (flags & O_TRUNC) fsFlags = fsFlags | fs.constants.O_TRUNC;
                                if (flags & O_EXCL) fsFlags = fsFlags | fs.constants.O_EXCL;

                                const fd = fs.openSync(abs, fsFlags, 0o644);
                                const h = makeHandle();
                                fds.set(h.id, fd);
                                sftp.handle(reqid, h.buf);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("READ", (reqid: number, handle: Buffer, offset: number, length: number) => {
                            const id = handle.readUInt32BE(0);
                            const fd = fds.get(id);
                            if (fd == null) return sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            try {
                                const buf = Buffer.allocUnsafe(length);
                                const bytesRead = fs.readSync(fd, buf, 0, length, offset);
                                if (bytesRead > 0) {
                                    sftp.data(reqid, buf.subarray(0, bytesRead));
                                } else {
                                    sftp.status(reqid, SSH2.SFTP_STATUS_CODE.EOF);
                                }
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("WRITE", (reqid: number, handle: Buffer, offset: number, data: Buffer) => {
                            const id = handle.readUInt32BE(0);
                            const fd = fds.get(id);
                            if (fd == null) return sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            try {
                                fs.writeSync(fd, data, 0, data.length, offset);
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("REMOVE", (reqid: number, p: string) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                fs.unlinkSync(abs);
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("RMDIR", (reqid: number, p: string) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                fs.rmdirSync(abs);
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("MKDIR", (reqid: number, p: string, attrs: any) => {
                            try {
                                const abs = safeJoin(rootDir, p);
                                const mode = attrs?.mode ?? 0o755;
                                fs.mkdirSync(abs, { recursive: false, mode });
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        sftp.on("RENAME", (reqid: number, oldPath: string, newPath: string) => {
                            try {
                                const a = safeJoin(rootDir, oldPath);
                                const b = safeJoin(rootDir, newPath);
                                fs.renameSync(a, b);
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OK);
                            } catch {
                                sftp.status(reqid, SSH2.SFTP_STATUS_CODE.FAILURE);
                            }
                        });

                        // Catch-alls for unimplemented ops
                        const notImpl = (name: string) => (reqid: number) => {
                            // You can add more as needed: SETSTAT, FSETSTAT, READLINK, SYMLINK, etc.
                            sftp.status(reqid, SSH2.SFTP_STATUS_CODE.OP_UNSUPPORTED);
                        };
                        sftp.on("SETSTAT", notImpl("SETSTAT"));
                        sftp.on("FSETSTAT", notImpl("FSETSTAT"));
                        sftp.on("READLINK", notImpl("READLINK"));
                        sftp.on("SYMLINK", notImpl("SYMLINK"));
                    });
                });
            });

            client.on("end", () => { /* client disconnected */ });
            client.on("error", () => { /* swallow per-connection errors */ });
        },
    );

    return {
        listen(port: number, host?: string, cb?: ListenCb) {
            const h = host || "0.0.0.0";
            server.listen(port, h, cb);
            return server;
        },
    };
}
