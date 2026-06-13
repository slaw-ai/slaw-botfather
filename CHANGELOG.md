# Changelog

All notable changes to SLAW Botfather are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Admin API auth gate (Phase 1 / audit finding C1).** `/api/admin` is now
  guarded by `adminAuth` middleware: a shared admin secret
  (`BOTFATHER_ADMIN_TOKEN`) is required as an `Authorization: Bearer` token and
  compared in constant time. The gate fails closed — when the tower is bound to a
  non-loopback interface without a token configured, admin requests return
  `503 admin_auth_required`. Loopback dev keeps zero-config convenience.
- **Safe loopback bind by default (Phase 1 / C1, M5).** The HTTP server now binds
  to `127.0.0.1` by default (`BOTFATHER_BIND` to widen). The process refuses to
  start when exposed off-loopback (`0.0.0.0`/any non-loopback) without
  `BOTFATHER_ADMIN_TOKEN` set, so the admin API can never be reachable off-box
  unauthenticated. This also neutralises the cross-instance IDOR (M5) for the
  single-admin model.

### Added

- `server/src/middleware/admin-auth.ts` — pre-SSO admin auth (single function so
  future EntraID/SSO can swap the body without touching route wiring).
- `bindHost` and `adminToken` fields on `BotfatherConfig`
  (`BOTFATHER_BIND`, `BOTFATHER_ADMIN_TOKEN`).
- README "Security: bind & admin auth" section documenting the bind/token matrix
  and `openssl rand -hex 32` token generation.
- `server/__tests__/admin-auth.test.ts` — 7 tests covering all three auth states
  plus a `listen()` host-argument assertion.

## [0.1.0]

- Initial control-tower build (B0–B4): fleet/cost/alerts/approvals UI, enrollment,
  skill registry + standard skills catalog, budget/token limits, Jira board sync.
