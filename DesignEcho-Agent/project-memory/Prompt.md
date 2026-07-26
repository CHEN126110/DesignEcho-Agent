# Project prompt

## Objective

Build and maintain an open-source, extensible design Agent that can understand goals, select capabilities, operate Adobe Photoshop through guarded UXP tools, observe results and evaluate completion.

## Boundaries

- Preserve the model-driven autonomous loop as the default execution path.
- Keep Knowledge, Skill, Tool, Memory, Evaluation and Policy independently governable.
- Do not publish credentials, customer assets, local models or private workspace state.
- Do not claim Photoshop E2E, real-provider behavior or visual quality without matching evidence.
- Prefer manifest and contract extensions over category-specific branches in the generic Agent runtime.

## Acceptance

- Public `main` remains buildable.
- Core tool and executor governance audits remain green.
- Security and privacy checks run before releases.
- Community decisions and breaking changes are documented.
