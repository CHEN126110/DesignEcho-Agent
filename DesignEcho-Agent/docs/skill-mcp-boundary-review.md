# Skill / MCP Boundary Review

## Conclusion

The current project mixes four different layers in one skill registry:

1. User-facing workflow skills
2. User-facing operation wrappers
3. Internal debug skills
4. System-only orchestration skills

This causes two kinds of failure:

- normal user commands can be misrouted into internal debug output
- thin wrappers are treated like full design skills, which blurs the product boundary

## Current Boundary Model

Two explicit axes are now used:

- `kind`
  - `workflow`
  - `operation`
  - `debug`
- `visibility`
  - `user-facing`
  - `internal-debug`
  - `system-only`

## Keep As User-Facing Workflow Skills

- `sku-batch`
- `layout-replication`
- `project-image-analysis`
- `find-and-edit-element`
- `text-font-replace`
- `main-image-design`
- `main-image-template-authoring`
- `detail-page-design`
- `detail-page-template-authoring`

These are multi-step flows with planning, validation, or repair logic.

## Keep Temporarily As User-Facing Operation Skills

- `matte-product`
- `smart-layout`
- `shape-morphing`
- `sku-config`
- `design-reference-search`
- `visual-analysis`
- `document-management`
- `save-current-template`

These still work as product features, but they are closer to operation wrappers than true workflows.
They are candidates to be folded into MCP tools or tool-driven engine actions later.

## Internal Debug Only

- `agent-panel-bridge`

This is not a normal user feature. It produces bridge/debug payloads and must never be reachable from ordinary user commands.

## System Only

- `autonomous-agent`

This is an orchestration fallback, not a product-level feature toggle.

## Immediate Rules

1. Normal user chat can invoke only `visibility = user-facing`.
2. `internal-debug` skills require explicit debug intent.
3. `system-only` skills are engine-owned and should not appear as normal capabilities.
4. User-facing summaries and settings views should hide internal/system skills by default.

## Next Cleanup Targets

1. Move thin operation skills toward MCP-first execution where appropriate.
2. Add the same boundary metadata to tool registry entries.
3. Stop using a single flat skill list as the only source for user-facing capability summaries.
