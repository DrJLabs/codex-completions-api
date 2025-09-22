# Release Workflow Readiness — Story 3.10

Artifacts prepared to validate `.github/workflows/release.yml` on the next tag:

- Snapshot script tested (see `snapshot-dry-run-20250922.md`).
- GitHub workflow verifies SHA256 and publishes tarball + lock + `SHA256SUMS`.
- README and dev-to-prod playbook instruct maintainers to tag `v*` and monitor workflow logs.
- Pending action: execute first tag-triggered run and attach outputs to the release notes.
