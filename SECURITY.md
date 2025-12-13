# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security-sensitive reports.

Preferred: use GitHub Security Advisories for this repository (Security → “Report a vulnerability”).

If advisories are not available in your fork/environment, open a minimal GitHub issue that does not include exploit details and request a private channel for follow-up.

## Supported versions

This project is a small proxy and does not maintain long-lived release branches. Security fixes are applied to the default branch and should be deployed by updating to the latest revision.

## Handling secrets

- Never commit `.env` files, bearer keys, or Codex auth state (`auth.json`).
- Treat all environment variables as secrets unless explicitly documented as safe.
- Use `npm run secret-scan` before pushing changes.
