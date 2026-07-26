# Documentation

## Current focus

Build a stable long-horizon operating model for the DesignEcho workspace so architecture work can continue without relying on volatile chat history.

## Collaboration note

This file records project state.

For the shared working context between user and agent, use:

- `C:\DesignEcho\docs\long-horizon\Collaboration.md`

## Workspace scope

- `C:\DesignEcho\DesignEcho-Agent`
- `C:\DesignEcho\DesignEcho-UXP`

## Current milestone status

### Milestone 1: Durable project memory

- status: done
- notes:
  - created the long-horizon memory stack
  - aligned it with existing architecture docs

### Milestone 2: Skill boundary hardening

- status: in progress
- notes:
  - explicit skill visibility and kind have been added
  - internal debug skills are being isolated from normal user chat

### Milestone 3: Unified model and image input handling

- status: active
- notes:
  - model-selection unification has started
  - image input normalization has started

### Milestone 4: Design-core-first architecture

- status: active
- notes:
  - scene core and design skills are being separated from executors

## Decisions made

1. Internal debug skills must not be user-invocable by default.
2. Workflow skills and operation wrappers must be treated differently.
3. Long-running project work needs durable markdown memory, not just chat context.
4. SKU remains out of scope for the current architecture-cleanup phase.

## Known issues / risks

1. Some operation-like skills still exist as first-class skills and should later move closer to MCP/tool registry.
2. Chinese encoding remains a real maintenance risk.
3. There are still historical docs and comments that may not reflect the newest architecture cleanup.

## Next concrete work

1. Continue narrowing skill vs MCP boundaries
2. Continue consolidating model-selection logic
3. Keep updating this file whenever architecture state changes
