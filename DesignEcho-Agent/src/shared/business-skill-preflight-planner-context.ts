import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
    BusinessSkillExecutionPreflightGate,
    BusinessSkillExecutionPreflightStatus,
    BusinessSkillExecutionRequestKind
} from './business-skill-execution-preflight-gate';

export interface BusinessSkillPreflightPlannerObservation {
    source: string;
    summary: string;
}

export interface BusinessSkillPreflightPlannerContext {
    version: 'business-skill-preflight-planner-context/v0';
    skillId: BusinessDesignSkillId;
    requestKind: BusinessSkillExecutionRequestKind;
    gateStatus: BusinessSkillExecutionPreflightStatus;
    warnings: string[];
    requiredInputs: string[];
    limitations: string[];
    observations: BusinessSkillPreflightPlannerObservation[];
}

export function buildBusinessSkillPreflightPlannerContext(
    gate: BusinessSkillExecutionPreflightGate
): BusinessSkillPreflightPlannerContext {
    const requiredInputs = gate.requiredInputs.map((item) => (
        item === 'visual_understanding_required' ? 'visual_understanding' : item
    ));
    return {
        version: 'business-skill-preflight-planner-context/v0',
        skillId: gate.skillId,
        requestKind: gate.requestKind,
        gateStatus: gate.status,
        warnings: gate.warnings,
        requiredInputs,
        limitations: [
            'This object is a read-only projection of the business preflight status.',
            'It does not grant execution permission or replace Tool preflight and Policy.',
            'It cannot claim main-image, detail-page, or SKU design quality.',
            'It cannot replace visual understanding, Photoshop readback, or manual review.'
        ],
        observations: []
    };
}
