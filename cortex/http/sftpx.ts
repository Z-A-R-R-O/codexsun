// sftpx.ts
/**
 * sftpx — minimal SFTP server over SSH using `ssh2`
 * - Barebones implementation mapping to a local directory (`rootDir`).
 * - Supports password auth (and optional public key auth).
 * - Implements common SFTP ops: REALPATH, STAT/LSTAT, OPENDIR/READDIR, OPEN/READ/WRITE/CLOSE,
 *   MKDIR, RMDIR, REMOVE, RENAME.
 *
 * NOTE: Requires `ssh2` and `@types/ssh2` in your project.
 *       This is intentionally simple; harden before production (chrooting, per-user roots, quotas, etc.).
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import ssh2 from 'ssh2';

const { Server: SSHServer } = ssh2 as unknown as { Server: new (...args: any[]) => any };

export interface SftpAuthUser {
  username: string;
  password?: string;
  // OpenSSH-format public key string(s) allowed for this user (optional)
  authorizedKeys?: string[];
}

export interface SftpOptions {
  hostKeys: Buffer[];         // e.g., [fs.readFileSync('ssh_host_ed25519_key')]
  users: SftpAuthUser[];      // static user list (simple)
  rootDir: string;            // filesystem root for SFTP (sandbox)
  banner?: string;
  debug?: boolean;
  onError?: (e: any) => void;
}

type HandleEntry =
  | { kind: 'file'; fd: number }
  | { kind: 'dir'; dir: fs.Dir };

function ok(stream: any, reqid: number) {
  stream.status(reqid, stream.STATUS_CODE.OK);
}
function fail(stream: any, reqid: number, code?: number) {
  stream.status(reqid, code ?? stream.STATUS_CODE.FAILURE);
}

function sanitize(root: string, p: string) {
  const resolved = path.resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  if (!resolved.startsWith(path.resolve(root))) {
    throw Object.assign(new Error('Path escape'), { code: 'EPERM' });
  }
  return resolved;
}

export function createSftpServer(opts: SftpOptions) {
  const { hostKeys, users, rootDir, banner, debug, onError } = opts;
    return new SSHServer({hostKeys, banner}, (client: any) => {
      if (debug) console.log('[sftp] client connected');

      client.on('authentication', (ctx: any) => {
          const user = users.find(u => u.username === ctx.username);
          if (!user) return ctx.reject();
          if (ctx.method === 'password' && user.password && ctx.password === user.password) return ctx.accept();
          if (ctx.method === 'publickey' && user.authorizedKeys?.length) {
              const pubKey = ctx.key.data.toString('base64');
              const match = user.authorizedKeys.some(k => k.includes(pubKey));
              if (match) return ctx.accept();
          }
          ctx.reject();
      });

      client.on('ready', () => {
          if (debug) console.log('[sftp] client auth ok');
          client.on('session', (accept: any) => {
              const session = accept();
              session.on('sftp', (acceptSftp: any) => {
                  const sftp = acceptSftp();
                  const handles = new Map<string, HandleEntry>();
                  let handleCounter = 1;

                  function makeHandle(entry: HandleEntry) {
                      const buff = Buffer.alloc(4);
                      buff.writeUInt32BE(handleCounter++, 0);
                      handles.set(buff.toString('hex'), entry);
                      return buff;
                  }

                  function getHandle(handle: Buffer) {
                      const key = handle.toString('hex');
                      return handles.get(key);
                  }

                  sftp.on('REALPATH', (reqid: number, givenPath: string) => {
                      try {
                          const abs = sanitize(rootDir, givenPath || '/');
                          const rel = path.posix.normalize('/' + path.relative(rootDir, abs).split(path.sep).join('/'));
                          sftp.name(reqid, [{filename: rel, longname: rel, attrs: {}}]);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });

                  sftp.on('STAT', async (reqid: number, p: string) => {
                      try {
                          const st = await fsp.stat(sanitize(rootDir, p));
                          sftp.attrs(reqid, statsToAttrs(st));
                      } catch {
                          fail(sftp, reqid, sftp.STATUS_CODE.NO_SUCH_FILE);
                      }
                  });
                  sftp.on('LSTAT', async (reqid: number, p: string) => {
                      try {
                          const st = await fsp.lstat(sanitize(rootDir, p));
                          sftp.attrs(reqid, statsToAttrs(st));
                      } catch {
                          fail(sftp, reqid, sftp.STATUS_CODE.NO_SUCH_FILE);
                      }
                  });

                  sftp.on('OPENDIR', async (reqid: number, p: string) => {
                      try {
                          const dir = await fsp.opendir(sanitize(rootDir, p));
                          const h = makeHandle({kind: 'dir', dir: dir as unknown as fs.Dir});
                          sftp.handle(reqid, h);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });

                  sftp.on('READDIR', async (reqid: number, handle: Buffer) => {
                      const entry = getHandle(handle);
                      if (!entry || entry.kind !== 'dir') return fail(sftp, reqid);
                      const dir = entry.dir;
                      try {
                          const batch: any[] = [];
                          for await (const dirent of dir) {
                              const full = path.join(dir.path, dirent.name);
                              let st;
                              try {
                                  st = await fsp.lstat(full);
                              } catch {
                                  continue;
                              }
                              batch.push({
                                  filename: dirent.name,
                                  longname: dirent.name,
                                  attrs: statsToAttrs(st)
                              });
                              if (batch.length >= 64) {
                                  sftp.name(reqid, batch);
                                  return;
                              }
                          }
                          // EOF
                          sftp.status(reqid, sftp.STATUS_CODE.EOF);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });

                  sftp.on('OPEN', async (reqid: number, p: string, flags: number, attrs: any) => {
                      void attrs;
                      try {
                          const fp = sanitize(rootDir, p);
                          const fd = await fsp.open(fp, flagsToFs(flags), 0o644);
                          const h = makeHandle({kind: 'file', fd: (fd as any).fd});
                          sftp.handle(reqid, h);
                      } catch (e: any) {
                          fail(sftp, reqid);
                      }
                  });

                  sftp.on('WRITE', (reqid: number, handle: Buffer, offset: number, data: Buffer) => {
                      const entry = getHandle(handle);
                      if (!entry || entry.kind !== 'file') return fail(sftp, reqid);
                      fs.write(entry.fd, data, 0, data.length, offset, (err) => {
                          if (err) return fail(sftp, reqid);
                          ok(sftp, reqid);
                      });
                  });

                  sftp.on('READ', (reqid: number, handle: Buffer, offset: number, length: number) => {
                      const entry = getHandle(handle);
                      if (!entry || entry.kind !== 'file') return fail(sftp, reqid);
                      const buf = Buffer.alloc(length);
                      fs.read(entry.fd, buf, 0, length, offset, (err, bytesRead) => {
                          if (err) return fail(sftp, reqid);
                          sftp.data(reqid, buf.subarray(0, bytesRead)); // <- preferred
                      });
                  });

                  sftp.on('CLOSE', (reqid: number, handle: Buffer) => {
                      const entry = getHandle(handle);
                      if (!entry) return fail(sftp, reqid);
                      if (entry.kind === 'file') {
                          fs.close(entry.fd, (err) => {
                              handles.delete(handle.toString('hex'));
                              if (err) return fail(sftp, reqid);
                              ok(sftp, reqid);
                          });
                      } else {
                          entry.dir.close().then(
                              () => {
                                  handles.delete(handle.toString('hex'));
                                  ok(sftp, reqid);
                              },
                              () => fail(sftp, reqid)
                          );
                      }
                  });

                  sftp.on('MKDIR', async (reqid: number, p: string, _attrs: any) => {
                        void _attrs;
                      try {
                          await fsp.mkdir(sanitize(rootDir, p), {recursive: false});
                          ok(sftp, reqid);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });
                  sftp.on('RMDIR', async (reqid: number, p: string) => {
                      try {
                          await fsp.rmdir(sanitize(rootDir, p));
                          ok(sftp, reqid);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });
                  sftp.on('REMOVE', async (reqid: number, p: string) => {
                      try {
                          await fsp.unlink(sanitize(rootDir, p));
                          ok(sftp, reqid);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });
                  sftp.on('RENAME', async (reqid: number, oldP: string, newP: string) => {
                      try {
                          await fsp.rename(sanitize(rootDir, oldP), sanitize(rootDir, newP));
                          ok(sftp, reqid);
                      } catch {
                          fail(sftp, reqid);
                      }
                  });

                  sftp.on('END', () => {
                      for (const [k, v] of handles) {
                          if (v.kind === 'file') try {
                              fs.closeSync(v.fd);
                          } catch {
                          }
                          if (v.kind === 'dir') try {
                              (v.dir as any).closeSync?.();
                          } catch {
                          }
                          handles.delete(k);
                      }
                      if (debug) console.log('[sftp] stream ended');
                  });
              });
          });
      });

      client.on('error', (e: any) => onError?.(e));
      client.on('end', () => {
          if (debug) console.log('[sftp] client disconnected');
      });
  });
}

function statsToAttrs(st: fs.Stats) {
  // ssh2 expects { mode, uid, gid, size, atime, mtime }
  return {
    mode: st.mode,
    uid: (st as any).uid ?? 0,
    gid: (st as any).gid ?? 0,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000)
  };
}

function flagsToFs(flags: number) {
  // ssh2 uses POSIX-like flags.
  const SSH_FXF_READ = 0x01;
  const SSH_FXF_WRITE = 0x02;
  const SSH_FXF_CREAT = 0x08;
  const SSH_FXF_TRUNC = 0x20;
  const SSH_FXF_APPEND = 0x04;

  const canRead = (flags & SSH_FXF_READ) !== 0;
  const canWrite = (flags & SSH_FXF_WRITE) !== 0;
  const create = (flags & SSH_FXF_CREAT) !== 0;
  const trunc = (flags & SSH_FXF_TRUNC) !== 0;
  const append = (flags & SSH_FXF_APPEND) !== 0;

  if (append) return 'a+';
  if (canRead && canWrite) {
    if (create && trunc) return 'w+';
    if (create) return 'a+';
    return 'r+';
  }
  if (canWrite) {
    if (create && trunc) return 'w';
    if (create) return 'a';
    return 'r+';
  }
  return 'r';
}
