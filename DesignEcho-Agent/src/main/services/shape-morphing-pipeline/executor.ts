import { WebSocketServer } from '../../websocket/server';
import type { AlignmentExecutionPlan } from './types';

export interface ApplyDisplacementExecutionOptions {
    preserveOriginal?: boolean;
    resultLayerName?: string;
}

export interface ApplyDisplacementExecutionResult {
    success: boolean;
    outputLayerId?: number;
    outputLayerName?: string;
    preservedOriginal?: boolean;
    error?: string;
}

export class ShapeMorphingExecutorService {
    constructor(private readonly wsServer: WebSocketServer) {}

    async alignLayer(plan: AlignmentExecutionPlan): Promise<boolean> {
        const subjectOffsetX = plan.subjectCenter.x - plan.layerCenter.x;
        const subjectOffsetY = plan.subjectCenter.y - plan.layerCenter.y;

        const result = await this.wsServer.sendRequest('alignToReference', {
            layerId: plan.layerId,
            scalePercent: plan.scalePercent,
            targetCenterX: plan.targetCenter.x,
            targetCenterY: plan.targetCenter.y,
            subjectOffsetX,
            subjectOffsetY
        });

        return Boolean(result?.success);
    }

    async applyDisplacement(
        layerId: number,
        sparseDisplacement: string,
        options: ApplyDisplacementExecutionOptions = {}
    ): Promise<ApplyDisplacementExecutionResult> {
        const result = await this.wsServer.sendRequest('applyDisplacement', {
            layerId,
            sparseDisplacement,
            preserveOriginal: options.preserveOriginal !== false,
            resultLayerName: options.resultLayerName
        }, 60000);

        return {
            success: Boolean(result?.success),
            outputLayerId: result?.outputLayerId ?? result?.layerId,
            outputLayerName: result?.outputLayerName ?? result?.layerName,
            preservedOriginal: result?.preservedOriginal === true,
            error: result?.error
        };
    }
}
