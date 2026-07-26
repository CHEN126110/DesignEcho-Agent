/**
 * Shared boundary declaration types for read-only context, tool execution, and claims.
 *
 * These are composed via `extends` to keep execution and claim boundaries explicit
 * without introducing a generic result container.
 *
 * Design rules:
 * - Each layer covers one concern (read-only state, tool execution, claims, Eagle).
 * - Literal types (`true` / `false`) are used when the value is invariant.
 * - Domain objects still choose their own context/result/verification fields.
 */

// ── Layer 1: Read-only context boundary ──

/**
 * Marks a context object as read-only with redacted raw payload.
 */
export interface ReadOnlyContextBoundary {
    readOnly: true;
    rawPayloadRedacted: true;
}

// ── Layer 2: Tool execution boundary ──

/**
 * Forbids running Photoshop or model provider tools.
 * Used by intent gates, observation policies, deliberation gates.
 */
export interface ToolExecutionBoundary {
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
}

// ── Layer 3: Claim boundary ──

/**
 * Forbids claiming design quality or task completion.
 * Used by context, intake, and review interfaces that must not
 * be interpreted as design delivery or task completion.
 */
export interface ClaimBoundary {
    canClaimTaskCompletion: false;
    canClaimDesignQuality: false;
}

// ── Layer 4: External system write boundary ──

/**
 * Forbids writing to Eagle (asset manager).
 * Used by eagle readonly knowledge, learning, and case index modules.
 */
export interface EagleWriteBoundary {
    doesNotWriteEagle: true;
}

// ── Convenience combinations ──

/**
 * Common combination for read-only context that also forbids
 * tool execution and quality/completion claims.
 * Used by agent-observation-channels, agent-execution-lifecycle, etc.
 */
export interface StrictReadOnlyBoundary
    extends ReadOnlyContextBoundary, ToolExecutionBoundary, ClaimBoundary {}

/**
 * Common combination for business-skill intake context that cannot claim quality.
 */
export interface IntakeContextBoundary extends ClaimBoundary {
    readOnly: true;
    rawPayloadRedacted: true;
}
