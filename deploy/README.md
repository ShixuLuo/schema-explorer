# Container deployment

The image serves the built frontend and proxies the AI and CQL APIs through one HTTP port. Rust and the resident Java worker stay inside the container on loopback. The frontend UI is unchanged. CQL is pinned to the exact official release checked locally.

```sh
docker build -t schema-explorer .
docker run -d --name schema-explorer --restart unless-stopped \
  -p 127.0.0.1:5186:8080 \
  -e PUBLIC_ORIGIN=https://schema-explorer.luo.sx \
  -e CQL_RUN_TIMEOUT_MS=300000 \
  -e OPENAI_API_KEY_FILE=/run/secrets/openai-key \
  -v /opt/schema-explorer/secrets/openai-key:/run/secrets/openai-key:ro \
  schema-explorer
```

Secrets are runtime-only files owned by UID 10001 with mode 0600. Never put them in the build context, Dockerfile, repository, or frontend variables. The image runs as UID 10001. No memory limit or custom Java heap limit is applied.

The outer reverse proxy terminates HTTPS and forwards to `127.0.0.1:5186`, with `client_max_body_size 16m` and `proxy_read_timeout 320s`. `/healthz` checks CQL readiness. Container restart stops both services and the owned Java worker. Use one container replica: in-flight jobs are intentionally ephemeral. Browser models/checkpoints remain in IndexedDB.

The gateway associates run results with a browser-session cookie, so one visitor cannot retrieve another visitor's source snapshot/results by guessing a run ID. Foreign origins are rejected when `PUBLIC_ORIGIN` is configured. `DEMO_AI_DAILY_LIMIT` defaults to 100 shared AI requests per UTC day (resets on gateway restart); set it explicitly for the intended demo budget. This is a small-demo limit, not durable billing enforcement. For a private demo, set `DEMO_PASSWORD_FILE` to a separate runtime secret file; the username is `demo`.

The existing local development commands and loopback services are unchanged.

## Current demo

The demo is served at https://schema-explorer.luo.sx using the existing OpenResty installation. `schema-explorer.luo.sx.conf` adds only that virtual host. The container uses Docker's `unless-stopped` restart policy.

HTTPS certificate renewal is managed by `schema-explorer-certificate.timer` and `renew-certificate.sh`; the webroot challenge remains available on HTTP while other HTTP requests redirect to HTTPS. Deploy the matching systemd service/timer under `/etc/systemd/system` and the renewal script under `/opt/schema-explorer`. The initial certificate was issued on October 29, 2026, and a renewal dry run succeeded.

The VPS sets `CQL_RUN_TIMEOUT_MS=300000` for a five-minute CQL execution budget. The AI service separately has a five-minute shared generation/repair budget. The gateway allows 310 seconds and OpenResty 320 seconds. Logs record phase timings without request payloads or credentials.
