# Deployment runbook

Production runs as a single Fly.io app: one Go binary serves the API and the
built React SPA, backed by Neon Postgres (ADR 0001), with Cloudflare
providing DNS only. This document covers what is already wired up in the repo
and the one-time account setup a human has to perform.

## Already done in this repo

- `Dockerfile`: multi-stage build that regenerates the tygo types, builds the
  Vite bundle, compiles static `api` and `migrations` binaries (CGO off), and
  ships them in a small Alpine image. The image serves the SPA from
  `/app/public` via `STATIC_DIR`.
- `fly.toml`: scale-to-zero (`auto_stop_machines = "stop"`,
  `auto_start_machines = true`, `min_machines_running = 0`), an HTTP health
  check on `/api/health`, the migrations `release_command`, and non-secret env.
- Migrations via `release_command` (ADR 0007): each `fly deploy` runs
  `/app/migrations migrate` in a temporary machine before the new release
  takes traffic. A failed migration aborts the deploy and the previous
  release keeps serving. The server never migrates at startup.
- Host redirects in Go: when `CANONICAL_HOST` is set (it is, in `fly.toml`),
  any request for another host (the bare apex robinandmadeline.com,
  madelineandrobin.com, robeline.co, robeline.com, and their www variants)
  gets a permanent redirect (301 for GET and HEAD, 308 otherwise) to
  `https://www.robinandmadeline.com` preserving path and query. `/api/health`
  is exempt so Fly's checks pass on any Host. The value must be a bare
  hostname (no scheme, port, or path); config loading rejects anything else
  at boot to rule out redirect loops.
- Real client IPs behind Fly: `TRUST_PROXY_HEADERS=true` makes the login rate
  limiter (ADR 0006) key on `Fly-Client-IP` (falling back to
  `X-Forwarded-For`) instead of the proxy's address. Leave it unset anywhere
  the server is reached directly; the headers are spoofable without a trusted
  proxy in front.

## Human setup, in order

### 1. Create the Fly app

```sh
fly apps create robinandmadeline   # must match `app` in fly.toml
```

If the name is taken, pick another and update `app` in `fly.toml`.

### 2. Provision Neon

1. Create a Neon project (any name) with a Postgres database.
2. Copy the pooled connection string and make sure it ends with
   `?sslmode=require`. It looks like:
   `postgres://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`

### 3. Set the Fly secrets

These are the exact env var names `pkg/config` reads. There is no
`ADMIN_PASSWORD_HASH`; the app reads the plaintext `ADMIN_PASSWORD` and
treats the environment as the secret store.

```sh
fly secrets set \
  DATABASE_URL='postgres://...?sslmode=require' \
  ADMIN_USERNAME='...' \
  ADMIN_PASSWORD='...' \
  JWT_SECRET="$(openssl rand -hex 32)"
```

Not yet: `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`. The email queue (ADR 0004)
is not implemented yet and `pkg/config` does not read them; set them when
that work lands.

### 4. First deploy

```sh
fly deploy --ha=false
```

`--ha=false` keeps the app at one machine. This matters: the in-memory login
rate limiter assumes a single process (ADR 0006), and two machines would each
enforce their own limit. If a second machine ever appears, remove it with
`fly scale count 1`.

### 5. Custom domains and certs on Fly

All four domains, apex and www each (the canonical host is
www.robinandmadeline.com; everything else exists only to redirect to it):

```sh
fly certs add robinandmadeline.com
fly certs add www.robinandmadeline.com
fly certs add madelineandrobin.com
fly certs add www.madelineandrobin.com
fly certs add robeline.co
fly certs add www.robeline.co
fly certs add robeline.com
fly certs add www.robeline.com
```

`fly certs add` prints the DNS records each cert needs; `fly certs show
<domain>` re-prints them later.

### 6. Cloudflare DNS

For each of the four domains (robinandmadeline.com, madelineandrobin.com,
robeline.co, robeline.com), in its Cloudflare zone:

1. Add the records `fly certs add` asked for. Typically: a `CNAME` for `www`
   to `robinandmadeline.fly.dev` (this is the canonical
   www.robinandmadeline.com record; the other www hostnames get the same
   kind of CNAME and just redirect), an apex record pointing at the app
   (either `A`/`AAAA` from `fly ips list`, where the shared IPv4 works for
   custom domains, or a `CNAME` to `robinandmadeline.fly.dev`, which
   Cloudflare flattens at the apex automatically), and the `_acme-challenge`
   `CNAME` for cert validation.
2. Set the records to DNS only (grey cloud), not proxied. Fly terminates TLS
   and needs to see the hostname directly; proxying through Cloudflare on top
   of Fly's certs causes cert validation and redirect-loop headaches.

No Cloudflare redirect or page rules are needed: every hostname points at the
same Fly app and the Go server permanently redirects everything that is not
www.robinandmadeline.com itself, including the bare apex.

### 7. Verify

- `https://www.robinandmadeline.com` serves the site.
- `https://robinandmadeline.com/anything?x=1` (the apex) 301s to
  `https://www.robinandmadeline.com/anything?x=1`.
- `https://madelineandrobin.com/anything?x=1` 301s to
  `https://www.robinandmadeline.com/anything?x=1`.
- `https://robeline.co/rsvp` and `https://robeline.com/rsvp` 301 to
  `https://www.robinandmadeline.com/rsvp`.
- `curl https://www.robinandmadeline.com/api/health` returns
  `{"status":"ok","database":"up"}`.
- Scale-to-zero: `fly machine list` shows the machine `stopped` a few minutes
  after the last request, and the next request starts it again.

## Day-to-day operations

- **Deploy**: `fly deploy`. The release_command migrates first; watch with
  `fly logs`. A migration failure aborts the deploy.
- **Scale-to-zero behavior**: Fly's proxy stops the machine when idle and
  boots it on the next request. The Go cold start is sub-second (static
  binary, no startup migrations, background-only DB ping), so visitors just
  see a normally fast first load while Neon also wakes from idle.
- **Logs**: `fly logs` (JSON via `LOG_FORMAT=json`).
- **Rollback**: `fly releases` then `fly deploy --image <previous image ref>`.
- **Local image check**: `mise build:docker` builds the exact production
  image (CI builds it on every PR too).
