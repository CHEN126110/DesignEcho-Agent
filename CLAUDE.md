# CLAUDE.md

This file is the contributor instruction entry point for Claude Code. Keep it synchronized with `AGENTS.md`.

## Project

DesignEcho is an open-source Agent + Adobe Photoshop UXP workspace:

- `DesignEcho-Agent/`: Electron runtime, agent orchestration, model providers, local inference, knowledge, memory and React UI.
- `DesignEcho-UXP/`: Photoshop UXP plugin and atomic Photoshop tools.
- `DesignEcho-Browser-Extension/`: optional localhost-only browser bridge.

The public repository excludes private project memory, customer assets, local models, runtime state and machine-specific diagnostics.

## Architecture principles

- `Agent = Model + Harness`.
- The model understands goals and chooses capabilities; the Harness owns task state, tools, permissions, memory and evaluation.
- Keep the model-driven autonomous loop as the default path. Do not add keyword gates that preempt model decisions.
- Put professional methods in Knowledge and Skill; put atomic external actions in Tool.
- Prefer manifest/contract/Capability Provider extensions over category branches in generic executors.
- Visual observations provide evidence but never grant write permission.
- Tool success is not completion. Writes require readback, delivery evidence or the applicable evaluation contract.
- Current v3 is the default real execution path; v5 is the evolving manifest/contract governance layer. Do not claim v5 fully owns runtime execution unless the real path proves it.

## Key paths

| Concern | Path |
| --- | --- |
| Agent engine | `DesignEcho-Agent/src/renderer/services/design-agent/engine.ts` |
| Autonomous loop | `DesignEcho-Agent/src/renderer/services/agent-runtime/` |
| Orchestration | `DesignEcho-Agent/src/renderer/services/agent-orchestration/` |
| Skill executors | `DesignEcho-Agent/src/renderer/services/skill-executors/` |
| v5 runtime | `DesignEcho-Agent/src/shared/agent-runtime-v5/` |
| Tool schemas | `DesignEcho-Agent/src/renderer/services/agent-runtime/tool-schemas.ts` |
| UXP tool registry | `DesignEcho-UXP/src/tools/registry.ts` |
| Main UI | `DesignEcho-Agent/src/renderer/components/ChatPanel.tsx` |

## Development rules

- Preserve unrelated user changes in dirty worktrees.
- Use UTF-8 without BOM. Source and Markdown use LF; Windows scripts use CRLF.
- User-visible strings are Simplified Chinese and should include an actionable next step.
- TypeScript top-level functions prefer `function` with explicit return types.
- React components use explicit Props types.
- Avoid nested ternaries and unnecessary `try/catch`.
- New tools must be registered consistently in schemas, execution classification, display metadata and the UXP registry.
- Do not commit secrets, real provider tokens, client paths, customer assets, PSD/PSB files, ONNX models, Eagle exports or generated build artifacts.

## Validation

```powershell
cd DesignEcho-Agent
npm run build:typecheck:renderer
npm run audit:tools
npm run audit:executor-generic
npm run maintenance:validate:agent-fast

cd ..\DesignEcho-UXP
npm run build
```

Select the smallest relevant validation tier, but never report unrun Photoshop or real-provider checks as passed.

Read `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `docs/OPEN_SOURCE_SCOPE.md` before publishing changes.
