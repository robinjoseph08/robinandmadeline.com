# Production image: one Go binary that serves both the API and the built
# React SPA (ADR 0001: a single scale-to-zero Fly machine serves everything).
# The migrations binary ships alongside it for the Fly release_command
# (ADR 0007). Tool versions are pinned to match mise.toml.

# =============================================================================
# Stage 1: Generate TypeScript API types
#
# The tygo-generated types are gitignored (ADR 0008: Go is the source of
# truth), so the image build regenerates them before the frontend build.
# =============================================================================
FROM golang:1.25.10-alpine AS typegen

WORKDIR /src

# Pinned to the tygo version in mise.toml.
RUN go install github.com/gzuidhof/tygo@v0.2.20

COPY go.mod go.sum ./
RUN go mod download

COPY tygo.yaml ./
COPY pkg/ ./pkg/

RUN tygo generate

# =============================================================================
# Stage 2: Build the frontend (Vite)
# =============================================================================
FROM node:24.16.0-alpine AS frontend

WORKDIR /src

# corepack reads the pinned pnpm version from package.json's packageManager.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install

# Full install (including devDependencies): `pnpm build` runs `tsc -b`, which
# type-checks the app and test projects exactly like CI before bundling.
RUN pnpm install --frozen-lockfile

COPY index.html vite.config.ts vitest.config.ts vitest.setup.ts ./
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.test.json ./
COPY app/ ./app/
COPY --from=typegen /src/app/types/generated/ ./app/types/generated/

# Outputs the bundle to build/app (vite.config.ts build.outDir).
RUN pnpm build

# =============================================================================
# Stage 3: Build the Go binaries
# =============================================================================
FROM golang:1.25.10-alpine AS backend

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY pkg/ ./pkg/
COPY internal/ ./internal/

# Static binaries (CGO off) so the runtime image needs no libc; -w -s strips
# debug info for a smaller image and faster cold-start pull.
RUN CGO_ENABLED=0 go build -ldflags "-w -s" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -ldflags "-w -s" -o /out/migrations ./cmd/migrations

# =============================================================================
# Stage 4: Runtime
# =============================================================================
FROM alpine:3.22

# ca-certificates for outbound TLS (Neon, and Mailgun once the email queue
# lands); tzdata so any future time.LoadLocation works.
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=backend /out/api /app/api
COPY --from=backend /out/migrations /app/migrations
COPY --from=frontend /src/build/app/ /app/public/

# Baked-in defaults the app always wants in a container; fly.toml [env] and
# `fly secrets` layer the deployment-specific values on top.
ENV PORT=8080 \
    LOG_FORMAT=json \
    STATIC_DIR=/app/public

USER app

EXPOSE 8080

CMD ["/app/api"]
