# DesignEcho-Agent contributor notes

The repository-level `../AGENTS.md` is authoritative for architecture, safety, privacy and validation.

Public planning uses `project-memory/CurrentTask.md` for the active alignment card and `project-memory/Intake.md` for incoming work. These files contain public project governance only; never copy private workspace history into them.

Within this directory:

- Keep the model-driven autonomous Agent loop as the default path.
- Put business methods in Skill/Knowledge and atomic actions in Tool.
- Prefer v5 manifest/contract extensions over new category branches in generic executors.
- Classify every new tool in the execution preflight and keep Agent/UXP registries synchronized.
- Do not reintroduce keyword routing gates into `DesignAgentEngine.run()`.
- Do not treat visual observation, Tool success or benchmark output as execution permission or quality completion.

Relevant validation:

```powershell
npm run build:typecheck:renderer
npm run audit:tools
npm run audit:executor-generic
npm run maintenance:validate:agent-fast
```
