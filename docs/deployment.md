# Deployment runbook

Production runs as a single Fly.io app: one Go binary serves the API and the
built React SPA, backed by Neon Postgres (ADR 0001), with Cloudflare providing
DNS only. Initial setup is complete (see the dated note below); this document
is the live topology, the day-to-day operations reference, and the record of
how production was built should it ever need rebuilding.

## Current production topology

- **App**: Fly.io app `robinandmadeline`, a single `shared-cpu-1` / 256MB
  machine in `iad` (Ashburn), scaling to zero when idle.
- **Database**: Neon Postgres in AWS `us-east-1` (N. Virginia), co-located with
  `iad` so app-to-database round trips stay near 1-2ms.
- **Domains**: the site serves from **www.robinandmadeline.com**. The bare apex
  and the alternate domains (madelineandrobin.com, robeline.co, robeline.com,
  and every www variant) permanently redirect there. Cloudflare is DNS only
  (grey cloud); the Go server does the redirecting.
- **Deploys**: zero-downtime bluegreen, run automatically by CI on every merge
  to `master`, with migrations applied first via the Fly `release_command`.
  Steady state is one machine.

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
- Zero-downtime deploys: `fly.toml` sets `[deploy] strategy = "bluegreen"`, so
  each deploy boots a replacement machine, waits for it to pass the
  `/api/health` check, switches traffic to it, and only then destroys the old
  machine. Steady state stays at one machine (the rate-limiter invariant,
  ADR 0006); the two run together only during the cutover.
- Deploy on merge: the `deploy` job in `.github/workflows/ci.yml` runs
  `flyctl deploy` on every push to `master`, after all the lint/test/build/e2e
  jobs pass. It is gated on the `FLY_API_TOKEN` repository secret: with the
  secret absent the job is green and does nothing, so it stays dormant until
  the human setup below is complete, then deploys automatically from then on.

## Human setup (completed 2026-06-13)

These one-time steps are done. They are kept as the record of how production
was provisioned, so it can be rebuilt from scratch (a fresh Fly app, a restored
Neon database, a domain change) by walking through them again.

### 1. Create the Fly app

```sh
fly apps create robinandmadeline   # must match `app` in fly.toml
```

If the name is taken, pick another and update `app` in `fly.toml`.

### 2. Provision Neon

1. Create a Neon project (any name) with a Postgres database in **AWS US East
   (N. Virginia), us-east-1**. This is the same metro as Fly's `iad`
   (`primary_region` in `fly.toml`), so app-to-database round trips stay near
   1-2ms. Per-query DB latency matters more here than app-to-user distance, so
   keep the two co-located: if you ever move one, move the other.
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

`--ha=false` keeps the first deploy at one machine. This matters: the
in-memory login rate limiter assumes a single process (ADR 0006), and two
always-on machines would each enforce their own limit. If a second machine
ever appears, remove it with `fly scale count 1`. Every deploy after this one
uses the bluegreen strategy from `fly.toml`, which keeps the steady-state
count at one (it boots a replacement, cuts over, then destroys the old
machine), so `--ha=false` is only needed on this first deploy.

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

In each of the four domains' Cloudflare zones, add an **A and an AAAA record,
DNS only (grey cloud)**, for both the apex and the `www` host, pointing at the
Fly app. These are the addresses `fly certs add` prints (and `fly ips list`
confirms): the IPv4 is Fly's shared address, the IPv6 is the app's dedicated
one. Re-check them with `fly ips list` if the app is ever recreated.

```
A     66.241.124.114
AAAA  2a09:8280:1::129:ec8:0
```

That is one A and one AAAA for each of the eight hostnames, sixteen records in
all. No `_acme-challenge` record is needed: once a hostname resolves to Fly,
Fly completes certificate validation itself. Keep every record DNS only (grey
cloud), never proxied. Fly terminates TLS and needs to see the hostname
directly; proxying through Cloudflare on top of Fly's certs causes cert
validation and redirect-loop headaches.

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

### 8. Enable deploy on merge

Create a deploy-scoped Fly token and add it to the repository so the `deploy`
job in CI can ship every merge to `master`:

```sh
fly tokens create deploy --expiry 8760h   # app-scoped deploy token
gh secret set FLY_API_TOKEN                # paste the token (the FlyV1 ... string)
```

Until this secret exists the `deploy` job runs green and skips, so nothing
deploys before the app, database, and secrets above are in place. Once it is
set, each merge to `master` runs the full CI suite and then `flyctl deploy`
(bluegreen, migrations first). Rotate or revoke the token with
`fly tokens list` / `fly tokens revoke`. To pause auto-deploy, remove the
secret with `gh secret delete FLY_API_TOKEN`.

## Day-to-day operations

- **Deploy**: normally automatic. Merging to `master` runs CI and then
  `flyctl deploy` (bluegreen; the release_command migrates first). Watch a
  deploy in the GitHub Actions run or with `fly logs`. A migration failure
  aborts the deploy and the previous release keeps serving. To deploy by hand
  (for a rollback or when CI is unavailable), run `fly deploy` locally.
- **Scale-to-zero behavior**: Fly's proxy stops the machine when idle and
  boots it on the next request. The Go cold start is sub-second (static
  binary, no startup migrations, background-only DB ping), so visitors just
  see a normally fast first load while Neon also wakes from idle.
- **Logs**: `fly logs` (JSON via `LOG_FORMAT=json`).
- **Rollback**: `fly releases` then `fly deploy --image <previous image ref>`.
- **Local image check**: `mise build:docker` builds the exact production
  image (CI builds it on every PR too).
