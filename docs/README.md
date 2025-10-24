# Documentation Overview

This repository ships with a lightweight public documentation set. Detailed internal runbooks, architecture notes, QA artifacts, and project history remain private by default.

## Public docs

- `README.md` (root) — quick start and operational summary.
- `docs/README.md` (this file) — how to configure optional local documentation.
- `docs/private/` (ignored) — optional folder for internal guides.

## Working with private docs locally

If you have access to the original internal documentation, place it under `docs/private/`. The directory is ignored by git so nothing will be committed accidentally. Suggested layout:

```text
docs/
├── README.md
└── private/
    ├── architecture/…
    ├── runbooks/…
    └── …
```

You can symlink or copy individual files back into tracked locations if you want specific items to be published.

## Updating the README references

The root README no longer links to the internal documents directly. If you add new public documentation, update both the root README and this file accordingly.
