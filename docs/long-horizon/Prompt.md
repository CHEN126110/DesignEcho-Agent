# Prompt

## Project

Turn the current DesignEcho workspace into a durable design agent system that can:

1. understand user intent correctly
2. understand Photoshop scene structure
3. distinguish MCP tools from design skills cleanly
4. execute design workflows without leaking internal debug behavior
5. sustain long-running project work without forgetting decisions or constraints

## Primary goals

1. Build a real design-agent core
   - unify scene understanding
   - unify model selection
   - unify tool boundaries

2. Keep user-facing behavior clean
   - no internal debug JSON in normal chat
   - no fake pondering
   - no hardcoded behavior that hides root causes

3. Improve design capability
   - not just tool execution
   - better planning, template authoring, and design workflows

4. Make long-running development durable
   - explicit milestones
   - explicit validations
   - explicit status log

## Non-goals

1. Do not expand SKU architecture during this phase.
2. Do not introduce new parallel runtimes.
3. Do not solve problems by fallback masking or defensive wrappers that hide the real defect.

## Hard constraints

1. Chinese text must be handled carefully.
   - avoid mojibake
   - treat UTF-8 source as the source of truth
2. Internal debug skills must not leak into user-facing chat.
3. Skills and MCP boundaries must become explicit.
4. Build and smoke checks are required after meaningful architecture changes.
5. Do not leave duplicated truth sources for:
   - model routing
   - skill visibility
   - tool capability

## Deliverables

1. Explicit long-horizon memory stack in this folder
2. Stable skill boundary model
3. Stable agent engine boundary
4. Clear plan for:
   - scene core
   - MCP/tool registry
   - design skills
   - multi-agent coordination

## Done when

The phase is considered done when all of the following are true:

1. project-level intent, plan, runbook, and status are stored in durable files
2. ordinary user commands cannot trigger internal-debug skills
3. user-facing skill list excludes internal and system-only skills
4. architecture work can be resumed after interruption without relying on chat history alone
5. validation commands for the current milestone pass
