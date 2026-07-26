# Business Skill Design Governance

## Purpose

This document is the governance gate for the three user-facing commerce design skills:

1. `main-image-design`
2. `detail-page-design`
3. `sku-batch`

These skills are business design scenarios selected by the Agent. They are not the top-level architecture of Design Agent OS, and they must not grow into isolated hardcoded workflows.

## External Architecture Integration Boundary

The user-provided Design Agent Studio A0-A9 architecture is accepted as a role model for business design work, but it does not replace the current Design Agent OS control plane.

For these three commerce skills:

1. A1-A6 roles may contribute brief, product understanding, market/user insight, copy strategy, reference direction and layout planning.
2. A7 may prepare preview or Photoshop execution requests only after the skill has a validated DesignDSL / ExecutionPlan.
3. A8 must verify real evidence before the skill claims completion.
4. A9 may record delivery and learnings only after export, review or failure evidence exists.
5. K0 / M0 / S0 / T0 / R0 / P0 are shared services, not private skill-owned subsystems.

Rules:

1. Skill logic must consume shared OS contracts and shared tools instead of building private copies of memory, knowledge, tool registry or Photoshop routing.
2. Main image, detail page and SKU can define business defaults, but they cannot define the global Agent / Tool / UXP boundary.
3. UXP panel-only capabilities remain panel tools until they pass a skill boundary review and receive Agent-side permission, schema and QA rules.
4. Current UI stays on the existing DesignEcho workbench path; business skills may improve their panels and evidence presentation, but this document does not authorize a clean-start UI rebuild.

## User Checkpoint Rule

Before changing implementation details for `main-image-design`, `detail-page-design` or `sku-batch`, the developer/Agent must tell the user first and align on the intended design direction.

This applies to changes in:

1. skill declaration and routing behavior
2. executor flow and Photoshop write order
3. prompts, DSL, planner evidence and QA contracts
4. template assumptions, layout rules and default copy rules
5. design knowledge, recipe retrieval and acceptance thresholds

The reason is practical: the user has design requirements and product-specific ideas that must inform these three skills before execution logic is changed.

## Skill Boundaries

### `main-image-design`

This skill is responsible for main image design tasks when the user explicitly asks the Agent to create or adjust main images.

Required design inputs before substantive implementation:

1. main image design standards
2. product and platform constraints
3. image selection rules
4. Photoshop placement and scaling rules
5. visual QA and screenshot evidence

### `detail-page-design`

This skill is responsible for detail page design tasks when the user explicitly asks the Agent to create, fill, inspect or improve detail pages.

Required design inputs before substantive implementation:

1. detail page screen structure standards
2. product selling-point hierarchy
3. image and text pairing rules
4. template and layer naming rules
5. per-screen QA and full-page acceptance evidence

### `sku-batch`

This skill is responsible for SKU batch generation and SKU-related Photoshop output tasks.

Required design inputs before substantive implementation:

1. SKU naming and combination rules
2. color and specification interpretation rules
3. template slot and layer matching rules
4. export naming and output QA rules
5. explicit note-generation policy

## Required Design Infrastructure

Every future change to these three skills must be grounded in the same Design Agent OS layers:

1. Intent Control Plane: decide whether the user wants chat, document operation, simple Photoshop operation or one of the three business skills.
2. Context Memory: read project, document, selected asset, previous task and current Photoshop state before executing.
3. Visual Perception: use real image or canvas evidence when design content depends on image understanding.
4. Knowledge And Recipe: use design standards, business rules, platform rules and Photoshop recipes as evidence, not as hidden hardcoded behavior.
5. Design DSL: translate intent and visual understanding into editable regions, text blocks, image slots and verification targets.
6. Photoshop Execution: map DSL steps to explicit Photoshop tools and traceable layer operations.
7. Verification And QA: verify document/layer/screenshot/output evidence before claiming completion.
8. User Feedback UX: show real model/provider thinking when available, real tool calls and evidence cards; do not show fixed local process text as thinking.
9. Acceptance Runtime Mode: production user experience and developer acceptance must remain separate. Codex may directly send requests to the Design Agent for effect validation only under explicit `developer_acceptance` mode; extra validation tokens, real provider calls and live Photoshop takeover require explicit opt-in and must not leak technical diagnostics into end-user output.

## Unified Pre-Change Checkpoint

Before changing business strategy for `main-image-design`, `detail-page-design` or `sku-batch`, run the implementation checkpoint and treat it as a gate:

1. user checkpoint: the user has explicitly agreed to enter this skill's business strategy design.
2. design standards: the expected visual and platform rules are written down.
3. knowledge or recipe source: the design rules come from user input, curated project knowledge, verified docs or reviewed recipes.
4. visual evidence plan: the skill knows which image, canvas, selection or project evidence it will use.
5. Photoshop tool plan: required Photoshop operations, failure modes and tool limits are known.
6. QA acceptance plan: screenshot, layer, file output or manual review evidence is defined.
7. performance budget: model calls, visual analysis, project scans and Photoshop operations have an explicit budget.

The code truth source for this gate is `src/shared/business-skill-implementation-checkpoint.ts`.

Allowed without this checkpoint:

1. infra-only evidence wiring
2. smoke tests that do not change business output
3. reports, project memory and diagnostics
4. bug fixes that preserve business strategy and Photoshop write order

Blocked without this checkpoint:

1. changing default layout, crop, scale, selection, copywriting or export behavior
2. adding hidden design constants as strategy
3. turning UXP panel-only tools into Agent skills without boundary review
4. using FEX or synthetic benchmarks as business strategy evidence

## Knowledge And Recipe Requirements

These three skills need a design knowledge layer before their design behavior is expanded:

1. design standards: business-specific visual rules and platform constraints
2. recipe library: reusable Photoshop construction recipes
3. material rules: how to identify originals, finished images, details, color singles and templates
4. QA rules: objective checks, screenshot checks and manual-review checkpoints
5. source evidence: local docs, user-provided rules, verified web search results or curated project knowledge

Lightweight structured knowledge is enough for the current phase. Do not start a heavy knowledge graph unless a later plan proves the need.

## Forbidden Patterns

1. Do not merge `main-image-design`, `detail-page-design` and `sku-batch` into one generic hardcoded business executor.
2. Do not add hidden layout constants as a substitute for design standards.
3. Do not claim design quality from metadata-only evidence, fake Photoshop, fake provider or synthetic smoke.
4. Do not route document save/export/close tasks into detail-page or main-image design because the prompt contains those words.
5. Do not expose UXP panel-only tools as Agent skills unless they are explicitly promoted through the skill boundary review.
6. Do not change these three skills without the user checkpoint described above.

## Acceptance Gate

This governance is considered present only when:

1. this document exists and names all three skills
2. `project-memory/Plan.md` records the user-checkpoint boundary
3. `project-memory/Intake.md` records the design standards and knowledge requirement
4. `project-memory/project-state.json` lists this as an active guard
5. `smoke:business-skill:design-governance` passes

Passing this gate does not mean the three design skills are complete. It only means future development must respect the split, checkpoint and evidence requirements.
