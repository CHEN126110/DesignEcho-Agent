# Long-Horizon Codex Workflow

This folder implements the durable project memory pattern described in OpenAI's article:

- [Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex?utm_source=chatgpt.com)

The goal is simple:

1. Keep project intent stable.
2. Prevent scope drift.
3. Make long runs resumable.
4. Make decisions auditable.
5. Keep human-agent collaboration state durable across interruptions.

## Files

- `Prompt.md`
  - project specification
  - goals, non-goals, hard constraints, deliverables
- `Collaboration.md`
  - shared human-agent working context
  - current thread focus
  - latest decisions, assumptions, and open loops
- `Plan.md`
  - milestone plan
  - acceptance criteria
  - validation commands
- `Implement.md`
  - runbook for Codex / agents
  - operating rules during execution
- `Documentation.md`
  - current status
  - decisions
  - known issues
  - next focus

## How to use

For long-running work in this repository:

1. Read `Prompt.md` first.
2. Read `Collaboration.md` to recover the current human-agent context.
3. Use `Plan.md` as the milestone source of truth.
4. Follow `Implement.md` while making changes.
5. Update `Documentation.md` whenever:
   - a milestone moves
   - a design/architecture decision is made
   - a new risk or known issue is found
6. Update `Collaboration.md` whenever:
   - the active working topic changes
   - the next concrete action changes
   - an interruption leaves unfinished loops

## Scope

This long-horizon memory stack is for the full workspace:

- `C:\DesignEcho\DesignEcho-Agent`
- `C:\DesignEcho\DesignEcho-UXP`

It should remain aligned with these existing architecture docs:

- `C:\DesignEcho\DesignEcho-Agent\docs\agent-architecture-system-review.md`
- `C:\DesignEcho\DesignEcho-Agent\docs\design-agent-execution-plan.md`
- `C:\DesignEcho\DesignEcho-Agent\docs\skill-mcp-boundary-review.md`

## Important distinction

This folder is not only for the product agent runtime.

It is also the durable memory layer for **our collaboration while developing the project**:

- what we are trying to change
- what has already been verified
- what is still open
- what should happen next
