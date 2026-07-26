/**
 * Agent Runtime v5 入口聚合（docs/41_AGENT_RUNTIME_ARCHITECTURE.md）
 * 代码控制的设计工作流运行时：R0 编排 + R1 确定性意图采集 + Project State owner-patch。
 */

export * from './contracts';
export * from './artifact-repository-contract';
export {
    AGENT_OPERATING_PROFILE,
    AGENT_OPERATING_PROFILE_VERSION,
    PRODUCT_SEMANTIC_MODEL_VERSION,
    buildAgentOperatingProfilePromptSection
} from './agent-operating-profile';
export type {
    AgentOperatingProfile
} from './agent-operating-profile';
export {
    OPERATING_CONTEXT_RUNTIME_ITEM_ID,
    OPERATING_CONTEXT_SNAPSHOT_VERSION,
    buildOperatingContextRuntimeItem,
    buildOperatingContextPromptSection,
    buildOperatingContextSnapshot,
    compileOperatingContextPrompt,
    resolveOperatingPhotoshopConnection,
    resolveOperatingPhotoshopDocumentPresence,
    validateOperatingContextSnapshot
} from './operating-context-snapshot';
export type {
    BuildOperatingContextSnapshotInput,
    OperatingContextFreshness,
    OperatingContextObservation,
    OperatingContextSnapshot,
    OperatingContextSnapshotValidation,
    OperatingPhotoshopContext,
    OperatingWorkflowContext,
    OperatingWorkflowNodeRef,
    OperatingWorkspaceContext
} from './operating-context-snapshot';
export {
    getManifestByLegacySkillId,
    getManifestByTaskType,
    getManifestBySkillId,
    listSkillManifests
} from './skill-runtime';
export {
    buildPlanningReflexionContract,
    buildReActReflexionLoopContract,
    buildReflexionHandoffFromReviewReport,
    buildRuntimeEvolutionIntake,
    validateManifestToolSkillBoundary
} from './reflexion-contract';
export {
    buildLegacyToolCapabilityBridge,
    summarizeLegacyToolCapabilityBridge,
    LEGACY_TOOL_CAPABILITY_MAP
} from './tool-capability-bridge';
export {
    buildRuntimeContractBundleForAgentTask,
    resolveSkillRuntimeManifestForAgentTask
} from './runtime-contract-bundle';
export {
    buildRuntimeStagePlan
} from './runtime-stage-plan';
export {
    RUNTIME_CONTRACT_STATUS_VERSION,
    RUNTIME_SELECTED_SKILL_HANDOFF_VERSION,
    buildRuntimeContractStatus,
    buildRuntimeSelectedSkillHandoff,
    validateRuntimeSelectedSkillHandoff
} from './runtime-selected-skill-handoff';
export type {
    RuntimeContractStatus,
    RuntimeContractStatusKind,
    RuntimeSelectedSkillHandoff,
    RuntimeSelectedSkillHandoffSource
} from './runtime-selected-skill-handoff';
export {
    RUNTIME_PLANNING_CONTEXT_SEED_DIGEST_VERSION,
    RUNTIME_PLANNING_CONTEXT_SEED_VERSION,
    buildRuntimePlanningContextSeed,
    buildRuntimePlanningContextSeedDigest,
    validateRuntimePlanningContextSeed,
    type RuntimePlanningContextSeed,
    type RuntimePlanningContextSeedDigest,
    type RuntimePlanningContextSeedValidation,
    type RuntimePlanningDeclarationStage,
    type RuntimePlanningDeclarations
} from './runtime-planning-context-seed';
export {
    RUNTIME_SESSION_DIGEST_VERSION,
    RUNTIME_SESSION_IDENTITY_VERSION,
    RUNTIME_SESSION_VERSION,
    advanceRuntimeSessionGeneration,
    advanceRuntimeSessionIdentity,
    appendRuntimeSessionObservation,
    applyRuntimeSessionStageEvaluation,
    buildRuntimeSessionDigest,
    createRuntimeSession,
    createRuntimeSessionIdentity,
    evaluateRuntimeSessionToolExecutionGate,
    finalizeRuntimeSession,
    projectRuntimeSessionCompletion,
    recordRuntimeSessionModelCall,
    recordRuntimeSessionRecoveryAttempt,
    recordRuntimeSessionToolCall,
    validateRuntimeSessionIdentity
} from './runtime-session';
export type {
    RuntimeSession,
    RuntimeSessionCompletionProjection,
    RuntimeSessionDigest,
    RuntimeSessionExecutionSummaryInput,
    RuntimeSessionIdentity,
    RuntimeSessionIdentityValidation,
    RuntimeSessionToolExecutionGate
} from './runtime-session';
export {
    buildRuntimeAccountingDigest,
    createRuntimeAccountingLedger,
    recordRuntimeModelCall,
    recordRuntimeRecoveryAttempt,
    recordRuntimeReflexion,
    recordRuntimeToolCall
} from './runtime-accounting';
export type {
    RuntimeAccountingDigest,
    RuntimeAccountingLedger,
    RuntimeAccountingStage,
    RuntimeAccountingStageBucket
} from './runtime-accounting';
export {
    applyRuntimeStageEvaluation,
    buildRuntimeStageStateFromEvaluation,
    createRuntimeStageState
} from './runtime-stage-state';
export {
    buildRuntimeCapabilityInventory,
    expandAgentCapabilities,
    HARNESS_BASELINE_CAPABILITY_IDS,
    resolveAgentCapabilities
} from './capability-resolver';
export {
    AGENT_TOOL_DECISION_POLICY_CAPABILITY_ID,
    DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
    DESIGN_PROJECT_STATE_CAPABILITY_ID,
    DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    SKU_WORKFLOW_STAGES_CAPABILITY_ID,
    TOOL_SAFETY_POLICY_CAPABILITY_ID,
    listBuiltinNonExecutableCapabilityProviders
} from './capability-provider-identities';
export {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
    MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
    SKU_BATCH_METHOD_KNOWLEDGE_ID,
    buildDesignMethodKnowledgeContext,
    listDesignMethodKnowledgeDefinitions,
    listDesignMethodKnowledgeProviderIdentities
} from './design-method-knowledge';
export type {
    DesignMethodKnowledgeContext,
    DesignMethodKnowledgeDefinition
} from './design-method-knowledge';
export {
    DETAIL_PAGE_EVALUATION_PROFILE_ID,
    DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    SKU_BATCH_EVALUATION_PROFILE_ID,
    buildDesignEvaluationProfileDigest,
    evaluateDesignEvaluationProfile,
    getDesignEvaluationProfileAssertions,
    getDesignEvaluationProfileById,
    getDesignEvaluationProfileVlmAssertions,
    listDesignEvaluationProfileCapabilityProviders,
    listDesignEvaluationProfiles,
    validateDesignEvaluationProfile
} from './design-evaluation-profiles';
export {
    adaptDesignEvaluationRecordsFromToolResults
} from './design-evaluation-result-adapters';
export {
    buildRuntimeScopedChangeVerificationRecords
} from './runtime-scoped-change-records';
export type {
    RuntimeReflexionContract,
    ReActReflexionLoopContract,
    ReflexionHandoff,
    RuntimeEvolutionDiagnosisTarget,
    RuntimeEvolutionIntake,
    ManifestToolSkillBoundaryResult
} from './reflexion-contract';
export type {
    LegacyToolCapabilityBridge,
    LegacyToolCapabilityBridgeEntry
} from './tool-capability-bridge';
export type {
    AgentTaskRuntimeContractBundle,
    BuildRuntimeContractBundleInput,
    ResolveSkillRuntimeManifestInput,
    RuntimeMethodManifestOverlay
} from './runtime-contract-bundle';
export type {
    RuntimeStagePlan,
    RuntimeStagePlanStep,
    RuntimeStageFailureTarget
} from './runtime-stage-plan';
export type {
    BuildRuntimeStageStateFromEvaluationInput,
    RuntimeStageEvaluationEvent,
    RuntimeStageEvaluationOutcome,
    RuntimeStageObservedStatus,
    RuntimeStageSnapshot,
    RuntimeStageState,
    RuntimeStageStateStatus,
    RuntimeStageTransitionDecision,
    RuntimeStageTransitionRecord
} from './runtime-stage-state';
export {
    appendRuntimeStageTraceEvent,
    buildRuntimeStageTraceDigest,
    createRuntimeStageTrace,
    runtimeStageTraceToEvaluationEvents
} from './runtime-stage-trace';
export {
    DECLARE_DESIGN_BRIEF_TOOL_NAME,
    buildDeclareDesignBriefToolSchema,
    buildRuntimeDesignBriefDigest,
    isDesignBriefControlTool,
    validateRuntimeDesignBriefDeclaration
} from './runtime-design-brief-declaration';
export type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDeclarationPayload,
    RuntimeDesignBriefDigest,
    RuntimeDesignBriefInputCoverage,
    RuntimeDesignBriefInputStatus,
    RuntimeDesignBriefToolSchema,
    RuntimeDesignBriefValidationIssue,
    RuntimeDesignBriefValidationResult
} from './runtime-design-brief-declaration';
export {
    DECLARE_DESIGN_STRATEGY_TOOL_NAME,
    buildDeclareDesignStrategyToolSchema,
    buildRuntimeDesignStrategyDigest,
    isDesignStrategyControlTool,
    validateRuntimeDesignStrategyDeclaration
} from './runtime-design-strategy-declaration';
export type {
    RuntimeDesignStrategyCopyDirection,
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDeclarationPayload,
    RuntimeDesignStrategyDigest,
    RuntimeDesignStrategyMessageArchitecture,
    RuntimeDesignStrategyObjective,
    RuntimeDesignStrategyToolSchema,
    RuntimeDesignStrategyValidationIssue,
    RuntimeDesignStrategyValidationResult,
    RuntimeDesignStrategyVisualDirection
} from './runtime-design-strategy-declaration';
export {
    CURRENT_R3_STRATEGY_REF,
    buildDeclareRuntimeActionPlanToolSchema,
    buildRuntimeActionPlanCapabilityContext,
    buildRuntimeActionPlanDeclarationFingerprint,
    buildRuntimeActionPlanDigest,
    buildRuntimeActionPlanReconciliationDigest,
    reconcileRuntimeActionPlanExecution,
    validateRuntimeActionPlanDeclaration
} from './runtime-action-plan-declaration';
export {
    appendRuntimeActionPlanExecutionObservation,
    createRuntimeActionPlanExecutionJournal
} from './runtime-action-plan-observation';
export {
    DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
    isRuntimeActionPlanControlTool
} from './runtime-action-plan-control';
export type {
    RuntimeActionPlanCapabilityContext,
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDeclarationPayload,
    RuntimeActionPlanDigest,
    RuntimeActionPlanResultKind,
    RuntimeActionPlanFailurePolicy,
    RuntimeActionPlanGraphSummary,
    RuntimeActionPlanReadiness,
    RuntimeActionPlanStep,
    RuntimeActionPlanStepKind,
    RuntimeActionPlanToolSchema,
    RuntimeActionPlanValidationIssue,
    RuntimeActionPlanValidationResult,
    RuntimeSemanticDesignDsl
} from './runtime-action-plan-declaration';
export type {
    RuntimeActionPlanExecutionJournal,
    RuntimeActionPlanExecutionObservation,
    RuntimeActionPlanExecutionObservationInput,
    RuntimeActionPlanExecutionObservationOutcome,
    RuntimeActionPlanOperationKind
} from './runtime-action-plan-observation';
export type {
    RuntimeActionPlanVerificationBinding,
    RuntimeActionPlanObservationAttribution,
    RuntimeActionPlanObservationAttributionOutcome,
    RuntimeActionPlanReconciliation,
    RuntimeActionPlanReconciliationDigest,
    RuntimeActionPlanStepReconciliation,
    RuntimeActionPlanStepReconciliationStatus
} from './runtime-action-plan-reconciliation';
export {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument
} from './runtime-execution-target';
export type {
    ResolveRuntimeExecutionTargetInput,
    RuntimeExecutionTargetAnchor,
    RuntimeExecutionTargetSource
} from './runtime-execution-target';
export {
    buildRuntimeDeliveryReceipt,
    readRuntimeDeliveryReceipt,
    RUNTIME_DELIVERY_RECEIPT_VERSION,
    verifyRuntimeDelivery
} from './runtime-delivery-receipt';
export type {
    RuntimeDeliveryReceipt,
    RuntimeDeliveryVerification
} from './runtime-delivery-receipt';
export {
    RUNTIME_TASK_SNAPSHOT_VERSION,
    RUNTIME_TASK_SNAPSHOT_V1_VERSION,
    attachArtifactRepositoryProjectionToRuntimeTaskSnapshot,
    buildRuntimeTaskSnapshot,
    readRuntimeTaskSnapshot
} from './runtime-task-snapshot';
export type {
    BuildRuntimeTaskSnapshotInput,
    ReadableRuntimeTaskSnapshot,
    RuntimeTaskSnapshot,
    RuntimeTaskSnapshotV1,
    RuntimeTaskSnapshotActionPlan,
    RuntimeTaskSnapshotActionStep,
    RuntimeTaskSnapshotActionStepStatus,
    RuntimeTaskSnapshotApprovalRef,
    RuntimeTaskSnapshotApprovalScope,
    RuntimeTaskSnapshotApprovalSource,
    RuntimeTaskSnapshotApprovalStatus,
    RuntimeTaskSnapshotExecution,
    RuntimeTaskSnapshotExecutionStatus,
    RuntimeTaskSnapshotIdentity,
    RuntimeTaskSnapshotOpenObligation,
    RuntimeTaskSnapshotStage
} from './runtime-task-snapshot';
export {
    RUNTIME_ARTIFACT_AUTHORIZATION_GRANT_VERSION,
    RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
    RUNTIME_ARTIFACT_FINALIZATION_VERSION,
    buildRuntimeArtifactFinalizationCandidates,
    buildRuntimeArtifactId,
    readRuntimeArtifactAuthorizationGrant,
    readRuntimeArtifactAuthorizationRequest,
    readRuntimeArtifactFinalizationRequest
} from './runtime-artifact-finalization';
export type {
    RuntimeArtifactAuthorizationGrant,
    RuntimeArtifactAuthorizationRequest,
    RuntimeArtifactFinalizationCandidate,
    RuntimeArtifactFinalizationRequest
} from './runtime-artifact-finalization';
export { validateArtifactPublicationPolicy } from './artifact-publication-policy';
export type {
    ArtifactPublicationAuthority,
    ArtifactPublicationPolicyInput,
    ArtifactPublicationPolicyIssue,
    ArtifactPublicationPolicyResult,
    ArtifactPublicationTransport
} from './artifact-publication-policy';
export {
    buildRuntimeContextEnvelope,
    compileRuntimeContext
} from './runtime-context-compiler';
export type {
    CompiledRuntimeContext,
    RuntimeContextEnvelope,
    RuntimeContextItem,
    RuntimeContextKind,
    RuntimeContextSlot,
    RuntimeContextTrust
} from './runtime-context-compiler';
export { validateSkillPackageContracts } from './skill-package-contract';
export type {
    SkillPackageContractIssue,
    SkillPackageContractIssueCode,
    SkillPackageContractReport,
    SkillPackageContractResult
} from './skill-package-contract';
export { validatePromptCapabilityGovernance } from './prompt-capability-governance';
export type {
    PromptCapabilityGovernanceDeclaration,
    PromptCapabilityGovernanceIssue,
    PromptCapabilityGovernanceIssueCode,
    PromptCapabilityGovernanceReport,
    PromptCapabilityGovernanceResult,
    PromptGovernanceActivation,
    PromptGovernanceAuthority,
    PromptGovernanceCapabilityKind,
    PromptGovernanceImplementation,
    PromptGovernanceOwner,
    PromptGovernanceScope
} from './prompt-capability-governance';
export { validateArtifactAliasGovernance } from './artifact-alias-governance';
export type {
    ArtifactAliasAuthority,
    ArtifactAliasGovernanceDeclaration,
    ArtifactAliasGovernanceIssue,
    ArtifactAliasGovernanceIssueCode,
    ArtifactAliasGovernanceReport,
    ArtifactAliasGovernanceResult
} from './artifact-alias-governance';
export {
    buildRuntimeResumeContextAnchor,
    buildRuntimeResumeFreshnessProbeRequest,
    evaluateRuntimeActionPlanResumeFreshness
} from './runtime-action-plan-resume-freshness';
export { evaluateRuntimeActionPlanMaturity } from './runtime-action-plan-maturity';
export type {
    RuntimeActionPlanMaturityObservationMode,
    RuntimeActionPlanMaturityMetrics,
    RuntimeActionPlanMaturityReport,
    RuntimeActionPlanMaturitySample
} from './runtime-action-plan-maturity';
export {
    buildRuntimeActionPlanNoRedoShadowDecision,
    buildRuntimeActionPlanNoRedoShadowDigest
} from './runtime-action-plan-no-redo-shadow';
export type {
    RuntimeActionPlanNoRedoShadowDecision,
    RuntimeActionPlanNoRedoShadowDigest,
    RuntimeActionPlanNoRedoShadowStatus
} from './runtime-action-plan-no-redo-shadow';
export type {
    RuntimeActionPlanResumeFreshness,
    RuntimeResumeContextAnchor,
    RuntimeResumeDocumentAnchor,
    RuntimeResumeDocumentAnchorFidelity,
    RuntimeResumeDocumentAnchorSource,
    RuntimeResumeFreshnessProbeRequest,
    RuntimeResumeCompletedStepDescriptor,
    RuntimeResumeProjectStateAnchor,
    RuntimeResumeToolLogEntry
} from './runtime-action-plan-resume-freshness';
export type {
    RuntimeStageTrace,
    RuntimeStageTraceDigest,
    RuntimeStageTraceEvent,
    RuntimeStageTraceEventInput,
    RuntimeStageTraceSource
} from './runtime-stage-trace';
export type {
    AgentCapabilityActivationResult,
    AgentCapabilityResolution,
    AgentCapabilityResolutionIssue,
    AgentCapabilityResolutionIssueCode,
    AgentCapabilityResolutionStatus,
    CapabilityKindReferenceMetrics,
    CapabilityReferenceResolution,
    CapabilityKind,
    CapabilityReferenceSet,
    ExecutableCapabilityKind,
    RuntimeCapabilityInventoryEntry,
    RuntimeCapabilityProviderExposure,
    RuntimeCapabilityProviderIdentity,
    RuntimeCapabilityReferenceProviderSource,
    RuntimeCapabilityProviderSource
} from './contracts/capability-resolution';
export type {
    DesignEvaluationCheck,
    DesignEvaluationVerificationRecord,
    DesignEvaluationVerificationSource,
    DesignEvaluationVerificationStatus,
    DesignEvaluationProfile,
    DesignEvaluationProfileDigest,
    DesignEvaluationProfileId,
    DesignEvaluationProfileIssueCode,
    DesignEvaluationProfileResult,
    DesignEvaluationProfileValidationIssue,
    DesignEvaluationProfileValidationIssueCode,
    DesignEvaluationProfileValidationResult
} from './design-evaluation-profiles';
export type {
    DesignEvaluationResultAdapterIssueCode,
    DesignEvaluationResultAdapterResult,
    DesignEvaluationSourceToolResult
} from './design-evaluation-result-adapters';
