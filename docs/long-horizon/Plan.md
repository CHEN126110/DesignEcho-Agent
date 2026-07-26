# Plan

## Milestone 1: Durable project memory

### Goal

Create a stable project-memory stack so long tasks no longer depend on chat history.

### Acceptance criteria

1. `Prompt.md`, `Plan.md`, `Implement.md`, `Documentation.md` exist
2. files reflect the real current project state
3. files cover scope, constraints, milestones, and current status

### Validation

- confirm files exist in `C:\DesignEcho\docs\long-horizon`
- review contents against current architecture docs

---

## Milestone 2: Skill boundary hardening

### Goal

Separate:

1. workflow skills
2. operation wrappers
3. internal debug skills
4. system-only orchestration skills

### Acceptance criteria

1. skill metadata contains explicit boundary fields
2. normal user chat cannot invoke internal-debug skills
3. user-facing capability summaries exclude internal/system skills
4. a smoke test proves these guarantees

### Validation

- `npm run build`
- `npm run smoke:skill-boundaries`
- `npm run smoke:mcp-host`

---

## Milestone 3: Unified model and image input handling

### Goal

Unify logic/copy/vision model selection and image input normalization.

### Acceptance criteria

1. main conversation entry uses one model-selection source of truth
2. image input is normalized before entering the agent loop
3. reference images participate in reasoning consistently

### Validation

- `npm run build`
- targeted manual checks for:
  - copy task
  - logic task
  - visual task with image input

---

## Milestone 4: Design-core-first architecture

### Goal

Shift from feature accumulation to core-first design understanding.

### Acceptance criteria

1. scene core remains the base for skill work
2. skills are clearly split from executors
3. MCP/tool boundaries continue to narrow

### Validation

- `npm run build`
- `npm run smoke:mcp-host`
- skill-specific smokes for changed flows

---

## Stop-and-fix rule

If any validation fails:

1. stop milestone progression
2. fix the failure first
3. update `Documentation.md`
4. only then continue
