# Document Sharding Guide

Document sharding lets BMAD workflows operate on large artifacts by splitting them into predictable "whole" and "sharded" views. This guide explains the concepts, how to configure `input_file_patterns`, and how to test sharded documents.

## When to Use Sharding

Use sharding when a single document is too large to load into a workflow context or when teams want to edit different sections independently. Common examples include:

- PRDs and tech specs with hundreds of sections
- UX research repositories that grow over time
- Architecture references with per-domain breakdowns

If a workflow can comfortably consume the entire document in one request, prefer the whole document path and skip sharding.

## Terminology

| Term | Description |
| --- | --- |
| **Whole document** | A single markdown file that contains the entire artifact. |
| **Sharded document** | A folder that stores multiple files representing slices of the artifact (for example `epic-a/index.md`). |
| **Preferred source** | The document path the workflow loads when both whole and sharded versions exist. |

## Directory Layout

```
product-docs/
├── prd.md                 # Whole document
└── prd/                   # Sharded variant (takes precedence when configured)
    ├── index.md
    ├── sections/
    │   ├── introduction.md
    │   └── scope.md
    └── epics/
        ├── checkout/index.md
        └── onboarding/index.md
```

## Configuring `input_file_patterns`

Every workflow that supports sharding declares patterns under `input_file_patterns`. Each entry should define **both** `whole` and `sharded` keys so the loader can pick the best available option.

```yaml
input_file_patterns:
  prd:
    whole: "{output_folder}/prd.md"
    sharded: "{output_folder}/prd/index.md"
  epics:
    whole: "{output_folder}/epics.md"
    sharded: "{output_folder}/epics/*/index.md"
  document_project:
    whole: "{output_folder}/docs.md"
    sharded: "{output_folder}/docs/index.md"
```

### Resolution Rules

1. If the sharded pattern matches at least one file, the workflow loads the sharded set.
2. If no shard exists, the workflow loads the whole document.
3. If neither pattern matches, surface a helpful error so the facilitator can request the missing artifact.

## Authoring Sharded Documents

1. Create a folder named after the document (for example `prd/`).
2. Add an `index.md` file that serves as the root summary.
3. Break the rest of the content into logical sections inside the folder (for example `sections/` or `epics/`).
4. Use relative links within shards so navigation works when rendered together.

## Testing Checklist

- **Whole only** – Remove the folder and confirm the workflow still loads `prd.md`.
- **Shard only** – Remove the root file and ensure the workflow loads each shard in the folder.
- **Both present** – Keep both options and verify the sharded content is preferred.
- **Selective load** – For workflows that support selective loading, confirm only the requested shards are pulled into context.

## Troubleshooting

- **Nothing loads:** Confirm the output folder matches `{output_folder}` and that file names align with the patterns.
- **Wrong shard selected:** Ensure wildcards use `*` and the path depth matches your folder structure.
- **Performance issues:** If too many shards load, tighten the sharded pattern or add workflow logic to request only the needed sections.

## Additional Resources

- Example configuration: `bmad/bmm/workflows/2-plan-workflows/prd/workflow.yaml`
- Selective load example: `bmad/bmm/workflows/4-implementation/epic-tech-context/workflow.yaml`

