---
title: DevWorkspace API
emoji: 🛰️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# DevWorkspace API — Hugging Face Space

Backend API for DevWorkspace, auto-synced from [Ahmed-Elkey/devworkspace](https://github.com/Ahmed-Elkey/devworkspace) branch `main`.

- Framework: NestJS 12 + Express 5 + Better Auth + Prisma/PostgreSQL + BullMQ/Redis
- Listens on port `7860` (required by HF Docker Spaces), bound to `0.0.0.0`
- Runtime env vars/secrets expected in Space settings:
  - `DATABASE_URL` (e.g. Neon PostgreSQL)
  - `REDIS_URL` (e.g. Upstash rediss://)
  - `BETTER_AUTH_SECRET` (random ≥ 32 chars)
  - `SMTP_URL` / `SMTP_FROM` (e.g. Gmail app password)
  - `APP_ORIGIN` (the Vercel frontend origin, https://)
