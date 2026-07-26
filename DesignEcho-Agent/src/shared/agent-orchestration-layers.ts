export type AgentOrchestrationLayerId =
    | 'react_orchestrator'
    | 'task_policy'
    | 'tool_adapter'
    | 'observation_contract';

export type AgentLayerResponsibility =
    | 'drive_react_loop'
    | 'choose_next_action'
    | 'domain_business_rules'
    | 'domain_stage_policy'
    | 'execute_photoshop_tools'
    | 'execute_mcp_tools'
    | 'normalize_tool_request'
    | 'convert_tool_result_to_agent_observation'
    | 'preserve_results_for_next_decision'
    | 'claim_design_quality'
    | 'photoshop_runtime_details'
    | 'user_visible_presentation';

export interface AgentOrchestrationLayerBoundary {
    id: AgentOrchestrationLayerId;
    label: string;
    purpose: string;
    allowedResponsibilities: AgentLayerResponsibility[];
    forbiddenResponsibilities: AgentLayerResponsibility[];
}

export const AGENT_ORCHESTRATION_LAYER_BOUNDARIES: AgentOrchestrationLayerBoundary[] = [
    {
        id: 'react_orchestrator',
        label: 'ReAct Orchestrator',
        purpose: 'Own the think-act-observe loop and decide whether to continue, repair, ask, or stop.',
        allowedResponsibilities: [
            'drive_react_loop',
            'choose_next_action',
            'preserve_results_for_next_decision'
        ],
        forbiddenResponsibilities: [
            'domain_business_rules',
            'domain_stage_policy',
            'execute_photoshop_tools',
            'execute_mcp_tools',
            'photoshop_runtime_details',
            'claim_design_quality'
        ]
    },
    {
        id: 'task_policy',
        label: 'Task Policy',
        purpose: 'Own domain-specific decisions such as SKU, main image, detail page, and open design stage policy.',
        allowedResponsibilities: [
            'domain_business_rules',
            'domain_stage_policy',
            'choose_next_action',
            'preserve_results_for_next_decision'
        ],
        forbiddenResponsibilities: [
            'execute_photoshop_tools',
            'execute_mcp_tools',
            'photoshop_runtime_details',
            'claim_design_quality'
        ]
    },
    {
        id: 'tool_adapter',
        label: 'Tool Adapter',
        purpose: 'Normalize and execute concrete tool calls through Photoshop, MCP, UXP, or local adapters.',
        allowedResponsibilities: [
            'normalize_tool_request',
            'execute_photoshop_tools',
            'execute_mcp_tools',
            'photoshop_runtime_details'
        ],
        forbiddenResponsibilities: [
            'domain_business_rules',
            'domain_stage_policy',
            'claim_design_quality'
        ]
    },
    {
        id: 'observation_contract',
        label: 'Observation Contract',
        purpose: 'Convert execution results into context the Agent can use for the next decision.',
        allowedResponsibilities: [
            'convert_tool_result_to_agent_observation',
            'preserve_results_for_next_decision'
        ],
        forbiddenResponsibilities: [
            'domain_business_rules',
            'execute_photoshop_tools',
            'execute_mcp_tools',
            'claim_design_quality',
            'user_visible_presentation'
        ]
    }
];

export function getAgentOrchestrationLayer(
    id: AgentOrchestrationLayerId
): AgentOrchestrationLayerBoundary | undefined {
    return AGENT_ORCHESTRATION_LAYER_BOUNDARIES.find((layer) => layer.id === id);
}
