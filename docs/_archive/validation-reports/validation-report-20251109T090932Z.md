# Validation Report

**Document:** docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml
**Checklist:** bmad/bmm/workflows/4-implementation/story-context/checklist.md
**Date:** $(date -u +"%Y-%m-%d %H:%M:%SZ")

## Summary
- Overall: 9/10 passed (90%)
- Critical Issues: 1

## Section Results

### Story Context Checklist
✓ Story fields (asA/iWant/soThat) captured  
Evidence: Context file includes `<asA>`, `<iWant>`, `<soThat>` mirroring the story narrative (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:12-15).

✓ Acceptance criteria list matches story draft exactly (no invention)  
Evidence: Context enumerates the same 21 ACs (lines 62-82) as the story source (docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md:11-33), with only XML-safe escaping.

✓ Tasks/subtasks captured as task list  
Evidence: The `<tasks>` block maps each AC to implementation + testing subtasks (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:16-55).

✓ Relevant docs (5-15) included with path and snippets  
Evidence: Eight doc references cite exact paths and `#L` ranges (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:85-92).

✗ Relevant code references included with reason and line hints  
Evidence: Code list names the right files but omits any `#L` line pointers, so developers lose the “line hints” the checklist demands (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:93-98).

✓ Interfaces/API contracts extracted if applicable  
Evidence: Interfaces section summarizes both `/v1/chat/completions` modes plus JSON-RPC events (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:107-109).

✓ Constraints include applicable dev rules and patterns  
Evidence: Constraints tie requirements to architecture, migration, tool-call spec, and risk plan sources (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:102-106).

✓ Dependencies detected from manifests and frameworks  
Evidence: Dependency list surfaces package.json-driven libraries and tooling (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:99).

✓ Testing standards and locations populated  
Evidence: `<tests>` outlines standards, concrete file locations, and scenario ideas (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:110-120).

✓ XML structure follows story-context template format  
Evidence: Document preserves the prescribed `<story-context>` → metadata/story/acceptance/artifacts/... nesting (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:1-122).

## Failed Items
1. Code references need explicit line hints so devs can jump directly to the relevant implementation hotspots (docs/_archive/story-contexts/2-9-stream-and-nonstream-tool-calls.md.context.xml:93-98).

## Partial Items
*(none)*

## Recommendations
1. Must Fix: Annotate each code reference with the precise line or section anchor (e.g., `src/handlers/chat/stream.js#L40-L75`) to satisfy the checklist.
2. Should Improve: Once line hints exist, rerun *validate-story-context to confirm full compliance.
3. Consider: Capture brief excerpts near those lines to speed up developer onboarding when reading the context file.
