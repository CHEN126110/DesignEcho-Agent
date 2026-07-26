# Implement

## Runbook

This file defines how Codex and supporting agents should operate on this workspace.

## Operating rules

1. Read `Prompt.md` before starting substantial work.
2. Read `Collaboration.md` before resuming interrupted work.
3. Treat `Plan.md` as the milestone source of truth.
4. Update `Documentation.md` when:
   - scope changes
   - a milestone changes state
   - a decision is made
   - a hidden risk is found
5. Update `Collaboration.md` when the human-agent working context changes.
6. Keep changes scoped to the active milestone.
7. Validate after meaningful changes.

## Change rules

1. No fallback masking.
2. No duplicate truth sources when consolidating architecture.
3. No internal debug output in normal user-facing paths.
4. Prefer structural fixes over surface suppression.

## Encoding rules

1. Assume Chinese text is high-risk for accidental corruption.
2. Prefer UTF-8 reads.
3. Prefer patch-based edits for Chinese-rich source files.
4. Verify source files themselves, not just terminal output.

## Validation rules

For architecture changes, run at minimum:

```bash
npm run build
npm run smoke:mcp-host
```

Then run the milestone-specific smoke if one exists.

## Documentation rules

When work changes the real state of the project:

1. update milestone status
2. record why the change was made
3. record any new risk or unresolved follow-up
4. record the new next action in `Collaboration.md` if the active thread has shifted

Do not leave the durable memory stack stale.
