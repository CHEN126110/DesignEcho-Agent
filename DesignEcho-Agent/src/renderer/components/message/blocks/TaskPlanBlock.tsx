import {
    CheckCircle2,
    Circle,
    CircleMinus,
    CircleX,
    LoaderCircle,
    type LucideIcon
} from 'lucide-react';

import type {
    AgentTaskPlanPresentationStep,
    AgentTaskPlanPresentationStepStatus
} from '../../../../shared/agent-task-plan-presentation';
import type { TaskPlanBlock as TaskPlanBlockType } from '../types';
import './TaskPlanBlock.css';

interface TaskPlanBlockProps {
    block: TaskPlanBlockType;
}

interface StepPresentation {
    Icon: LucideIcon;
    label: string;
}

function resolveStepPresentation(status: AgentTaskPlanPresentationStepStatus): StepPresentation {
    switch (status) {
        case 'completed':
            return { Icon: CheckCircle2, label: '已完成' };
        case 'running':
            return { Icon: LoaderCircle, label: '正在处理' };
        case 'failed':
            return { Icon: CircleX, label: '处理失败' };
        case 'blocked':
            return { Icon: CircleMinus, label: '等待前置步骤' };
        case 'pending':
        default:
            return { Icon: Circle, label: '待处理' };
    }
}

function TaskPlanStep({ step }: { step: AgentTaskPlanPresentationStep }): React.ReactElement {
    const { Icon, label } = resolveStepPresentation(step.status);
    return (
        <li
            className={`task-plan-step task-plan-step--${step.status}`}
            data-step-id={step.id}
            data-status={step.status}
        >
            <Icon
                className="task-plan-step-icon"
                size={15}
                strokeWidth={1.9}
                aria-hidden="true"
            />
            <span className="task-plan-step-label">{step.label}</span>
            <span className="task-plan-step-status sr-only">{label}</span>
        </li>
    );
}

export function TaskPlanBlock({ block }: TaskPlanBlockProps): React.ReactElement {
    const { presentation } = block;
    return (
        <section
            className="message-block task-plan-block"
            data-testid="agent-task-plan"
            data-session-id={presentation.identity.sessionId}
            data-generation={presentation.identity.generation}
            data-revision={presentation.identity.revision}
            aria-label={`任务计划：${presentation.goal}`}
            aria-live="polite"
        >
            <div className="task-plan-heading">
                <span className="task-plan-heading-label">执行计划</span>
                <span className="task-plan-goal">{presentation.goal}</span>
            </div>
            <ol className="task-plan-steps">
                {presentation.steps.map((step) => (
                    <TaskPlanStep key={step.id} step={step} />
                ))}
            </ol>
        </section>
    );
}
