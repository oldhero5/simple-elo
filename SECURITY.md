# Security

## What this app does not do

- **There is no authentication.** There are no accounts, passwords or roles. Anyone who can reach the web UI, and so its `/api` routes, can add, edit and deactivate people, record ratings, and start or end rounds.
- **Votes are anonymous.** A rating records the pair, the result, the ratings before and after, and the time. It does not record who voted. Changes to people are not kept as history; the server log only notes additions, deactivations and reactivations by id.
- **Data is not encrypted at rest.** Names, ranks and every comparison result sit in plain form in `data/elo_ratings.db`.

Treat the data as sensitive: it is a ranking of real people.

## Intended deployment

Run it on a network where everyone who can reach it is trusted to rate, such as your tailnet. The README's [Tailscale section](README.md#open-it-from-your-phone-over-tailscale) describes three ways to do that.

- Do not expose port 3000 to the internet, and do not turn on Tailscale Funnel. The sidecar's `tailscale/serve.json` sets `AllowFunnel` to false.
- Set `ELO_BIND` in `.env` to keep the app off the LAN: the host's Tailscale IP for plain HTTP over the tailnet, or `127.0.0.1` when you use `tailscale serve` or the sidecar.
- Tailscale access controls (ACLs or grants) can limit which tailnet users and devices reach the host.
- Protect `.env`: it holds `TS_AUTHKEY` and is ignored by git. The sidecar keeps its node key in the `tailscale-state` Docker volume.

## What is in place

- **SQL.** Every value is passed to DuckDB as a bound parameter. The only SQL built from strings splices in constant column lists and `?` placeholders.
- **Input validation.** Request bodies are pydantic models: names are 1 to 80 characters and ranks 1 to 12 after trimming, `initial_elo` is an integer from 100 to 3000, and a vote's `winner_id` must be one of the two people in that matchup (or null for a draw). Each multi-step write runs in one transaction and rolls back on error.
- **Error responses.** Clients get short messages such as "Person not found". Unexpected errors return a generic "Internal server error", and the traceback goes only to the server log.
- **Network.** The backend container is not published to the host; only the frontend's port is. The browser talks to the frontend's own origin, which forwards `/api` to the backend, so CORS is off unless `CORS_ORIGINS` is set.
- **Containers.** The backend entrypoint starts as root only to give `./data` to the `app` user (uid 10001), then switches to that user with `setpriv` before starting uvicorn. The frontend image runs as the `node` user. The backend image has no compiler, and both images use `.dockerignore` files so local virtualenvs, `node_modules`, databases and `.env` files are not copied in.
- **Pinned dependencies.** Backend packages are pinned to exact versions in `backend/requirements.txt`. The frontend installs exactly what `frontend/package-lock.json` lists (`npm ci` in the Docker build and in CI). Base images (`python:3.12-slim`, `node:22-alpine`, `tailscale/tailscale:stable`) are tags, not digests; `docker compose build --pull` picks up their updates.
- **Pre-commit hooks.** bandit checks the backend code and detect-secrets checks every file except the two lockfiles against `.secrets.baseline`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Known gaps

- No dependency vulnerability scanning runs automatically. You can run these by hand:

  ```bash
  uvx pip-audit -r backend/requirements.txt
  cd frontend && npm audit --omit=dev
  ```

- Next.js 14 is out of support and has unpatched advisories, so the frontend runs Next.js 16 (`npm audit --omit=dev` reported no known vulnerabilities when it was pinned). The image optimizer is switched off (`images.unoptimized`), because the app uses no `next/image` and that endpoint has a history of advisories. Re-run `npm audit` before upgrading or deploying.

## Supported versions

Only the latest commit on `main` gets fixes.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: https://github.com/oldhero5/simple-elo/security/advisories/new

If that page says private reporting is not enabled, open a normal issue that asks for a private contact, and leave the details out of it.

Include what you found, how to reproduce it, and what an attacker could do with it.
