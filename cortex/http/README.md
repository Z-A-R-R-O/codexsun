# Bare Node server (using chttpx)

This runs your Tenant API on a raw Node `http` server—no Express/Fastify—via the small adapter in `chttpx.ts`.

## Files
- `server.node.ts` — boots the Node server and mounts routes
- `tenant.routes.ts` — route manifest using `TenantService`
- depends on: `../chttpx.ts`, `../tenant/tenant.service.ts`, and your DB connection in `../connection.ts`

## Run
```bash
# Install ts-node if needed
npm i -D ts-node typescript

# Start (transpile-only for speed)
TS_NODE_TRANSPILE_ONLY=1 ts-node /mnt/data/bare-node/server.node.ts
```

## Endpoints
- `GET /health` — app health
- `GET /api/tenants/health` — DB health via `Default().Healthz()`
- `GET /api/tenants` — list (limit, offset, q)
- `GET /api/tenants/:id`
- `POST /api/tenants`
- `PUT /api/tenants/:id`
- `DELETE /api/tenants/:id`


**Supported HTTP methods:** GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, TRACE, CONNECT


## All-in-one server (HTTP + HTTPS + SFTP)

`server.all.ts` starts HTTP, HTTPS (TLS), and SFTP simultaneously.

```bash
# Generate dev TLS key/cert if needed (OpenSSL self-signed example)
openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -subj "/CN=localhost" -days 365

# Generate SSH host key (ed25519)
ssh-keygen -t ed25519 -N "" -f ssh_host_ed25519_key

# Run
HTTP_PORT=3000 HTTPS_PORT=3443 SFTP_PORT=2022 \
SFTP_USER=demo SFTP_PASS=demo \
TS_NODE_TRANSPILE_ONLY=1 ts-node /mnt/data/bare-node/server.all.ts
```

Default SFTP root is `./sftp-root` (created if missing). Use any SFTP client:
```
sftp -P 2022 demo@localhost
# password: demo
```
