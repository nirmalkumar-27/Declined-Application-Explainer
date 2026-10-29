# Declined Application Explainer

A React + Vite demo that explains synthetic loan decisions in plain language, shows bounded changes that could alter a demo outcome, and exposes a structured audit trail.

> **Demo only:** Applications and decisions are synthetic. This project is not a credit model or a lending product and must not be used for real lending decisions.

For the model approach and its fairness and customer-letter guardrails, see [`artifacts/declined-explainer/README.md`](artifacts/declined-explainer/README.md).

## Requirements

- Node.js 24
- pnpm

Install dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
```

## Run in Replit

Use the **Run** button. The workspace's configured workflows start the web app and API server with the ports and URL routing defined for this project.

To start the services manually in separate Replit shell sessions:

```sh
# API server
PORT=8080 pnpm --filter @workspace/api-server run dev
```

```sh
# Web app
PORT=23679 BASE_PATH=/ pnpm --filter @workspace/declined-explainer run dev
```

The web preview is served at `/`. The API is routed under `/api`.

## Checks and build

Run the model tests:

```sh
pnpm --filter @workspace/declined-explainer run test
```

Typecheck the workspace:

```sh
pnpm run typecheck
```

Build the workspace locally:

```sh
PORT=23679 BASE_PATH=/ pnpm run build
```

The web build is written to `artifacts/declined-explainer/dist/public`.

## Replit publishing

The Replit deployment configuration is already included; a separate `Dockerfile` or `Procfile` is not needed for Replit:

- [`artifacts/declined-explainer/.replit-artifact/artifact.toml`](artifacts/declined-explainer/.replit-artifact/artifact.toml) builds and serves the web app as a static site and rewrites app routes to `index.html`.
- [`artifacts/api-server/.replit-artifact/artifact.toml`](artifacts/api-server/.replit-artifact/artifact.toml) builds and runs the API server and defines its health check.
- [`.replit`](.replit) selects Replit's autoscale deployment target.

To publish, open Replit's **Publishing** tool and publish the project. Replit uses these artifact settings for the production build and services.

The demo works without an AI key. To enable the optional Claude letter rewrite, add `ANTHROPIC_API_KEY` through Replit Secrets before publishing. Do not put keys in this repository or in a `.env` file.
