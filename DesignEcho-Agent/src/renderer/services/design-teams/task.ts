import { getDesignTeammateDefinition } from './registry';
import type {
    DesignTeamMessage,
    DesignTeammateDefinition,
    DesignTeammateTaskRequest,
    DesignTeammateTaskResult,
    DesignTeammateTaskStatus
} from '../../../shared/types/design-team.types';

interface FinalizeTaskInput {
    success: boolean;
    message: string;
    iterations: number;
    toolsUsed: string[];
    error?: string;
    cancelled?: boolean;
}

function createMessage<TPayload>(
    taskId: string,
    fromRole: DesignTeammateTaskRequest['role'],
    type: DesignTeamMessage['type'],
    payload: TPayload,
    toRole?: DesignTeamMessage['toRole']
): DesignTeamMessage<TPayload> {
    return {
        type,
        fromRole,
        toRole,
        taskId,
        timestamp: new Date().toISOString(),
        payload
    };
}

export class DesignTeammateTask {
    readonly id: string;
    readonly request: DesignTeammateTaskRequest;
    readonly definition: DesignTeammateDefinition;
    private status: DesignTeammateTaskStatus = 'pending';
    private readonly messages: DesignTeamMessage[] = [];
    private startedAt: string | null = null;

    constructor(taskId: string, request: DesignTeammateTaskRequest) {
        this.id = taskId;
        this.request = request;
        this.definition = getDesignTeammateDefinition(request.role);
        this.messages.push(createMessage(
            this.id,
            request.role,
            'task_status',
            {
                status: 'pending',
                role: request.role
            },
            'coordinator'
        ));
        if (request.context) {
            this.messages.push(createMessage(
                this.id,
                request.role,
                'task_context',
                {
                    context: request.context
                },
                'coordinator'
            ));
        }
    }

    markRunning(): void {
        if (this.status !== 'pending') return;
        this.status = 'running';
        this.startedAt = new Date().toISOString();
        this.messages.push(createMessage(
            this.id,
            this.request.role,
            'task_status',
            {
                status: 'running',
                role: this.request.role
            },
            'coordinator'
        ));
    }

    finalize(input: FinalizeTaskInput): DesignTeammateTaskResult {
        const finishedAt = new Date().toISOString();
        const terminalStatus: DesignTeammateTaskStatus = input.cancelled
            ? 'cancelled'
            : input.success
                ? 'completed'
                : 'failed';
        this.status = terminalStatus;

        this.messages.push(createMessage(
            this.id,
            this.request.role,
            'task_status',
            {
                status: terminalStatus,
                role: this.request.role,
                success: input.success,
                error: input.error
            },
            'coordinator'
        ));

        const outputMessage = createMessage(
            this.id,
            this.request.role,
            this.definition.outputType,
            {
                success: input.success,
                message: input.message,
                iterations: input.iterations,
                toolsUsed: input.toolsUsed,
                ...(input.error ? { error: input.error } : {})
            },
            'coordinator'
        );

        this.messages.push(outputMessage);

        return {
            success: input.success,
            taskId: this.id,
            role: this.request.role,
            status: terminalStatus,
            message: input.message,
            iterations: input.iterations,
            toolsUsed: input.toolsUsed,
            outputType: this.definition.outputType,
            startedAt: this.startedAt || finishedAt,
            finishedAt,
            messages: [...this.messages],
            outputMessage,
            ...(input.error ? { error: input.error } : {})
        };
    }
}
