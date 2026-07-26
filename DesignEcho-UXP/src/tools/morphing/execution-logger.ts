/**
 * 形态变形执行日志器
 * 
 * 提供详细的执行流程追踪、性能计时、错误记录
 * 便于问题定位和调试
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'step' | 'perf';

export interface ExecutionStep {
    stepNumber: number;
    name: string;
    status: 'started' | 'completed' | 'failed' | 'skipped';
    startTime: number;
    endTime?: number;
    duration?: number;
    data?: any;
    error?: string;
    children?: ExecutionStep[];
}

export interface ExecutionContext {
    taskId: string;
    taskName: string;
    startTime: number;
    steps: ExecutionStep[];
    currentStep: number;
    logs: LogEntry[];
    metadata: Record<string, any>;
}

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    stepNumber: number | null;
    message: string;
    data?: any;
    duration?: number;
}

/**
 * 执行日志器
 */
class ExecutionLogger {
    private contexts: Map<string, ExecutionContext> = new Map();
    private currentContextId: string | null = null;
    private logCallback: ((entry: LogEntry) => void) | null = null;

    /**
     * 设置日志回调（用于发送到 Agent）
     */
    setLogCallback(callback: (entry: LogEntry) => void): void {
        this.logCallback = callback;
    }

    /**
     * 开始新的执行任务
     */
    startTask(taskName: string, metadata?: Record<string, any>): string {
        const taskId = `${taskName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const context: ExecutionContext = {
            taskId,
            taskName,
            startTime: performance.now(),
            steps: [],
            currentStep: 0,
            logs: [],
            metadata: metadata || {}
        };
        
        this.contexts.set(taskId, context);
        this.currentContextId = taskId;
        
        this.log('info', `═══════════════════════════════════════════════════════════`);
        this.log('info', `🚀 开始任务: ${taskName}`);
        this.log('info', `   任务ID: ${taskId}`);
        if (metadata) {
            this.log('debug', `   元数据: ${JSON.stringify(metadata)}`);
        }
        this.log('info', `───────────────────────────────────────────────────────────`);
        
        return taskId;
    }

    /**
     * 结束任务
     */
    endTask(taskId?: string, success: boolean = true): ExecutionContext | null {
        const id = taskId || this.currentContextId;
        if (!id) return null;
        
        const context = this.contexts.get(id);
        if (!context) return null;
        
        const totalDuration = performance.now() - context.startTime;
        
        this.log('info', `───────────────────────────────────────────────────────────`);
        if (success) {
            this.log('info', `✅ 任务完成: ${context.taskName}`);
        } else {
            this.log('error', `❌ 任务失败: ${context.taskName}`);
        }
        this.log('perf', `⏱️ 总耗时: ${totalDuration.toFixed(2)}ms`);
        this.log('info', `   步骤数: ${context.steps.length}`);
        this.log('info', `═══════════════════════════════════════════════════════════`);
        
        // 输出步骤摘要
        this.logStepsSummary(context);
        
        if (this.currentContextId === id) {
            this.currentContextId = null;
        }
        
        return context;
    }

    /**
     * 开始一个步骤
     */
    startStep(stepName: string, data?: any): number {
        const context = this.getCurrentContext();
        if (!context) {
            console.warn('[ExecutionLogger] 没有活动的任务上下文');
            return -1;
        }
        
        context.currentStep++;
        const stepNumber = context.currentStep;
        
        const step: ExecutionStep = {
            stepNumber,
            name: stepName,
            status: 'started',
            startTime: performance.now(),
            data
        };
        
        context.steps.push(step);
        
        this.log('step', `[${stepNumber}] ▶ ${stepName}`, data);
        
        return stepNumber;
    }

    /**
     * 完成步骤
     */
    endStep(stepNumber: number, success: boolean = true, result?: any): void {
        const context = this.getCurrentContext();
        if (!context) return;
        
        const step = context.steps.find(s => s.stepNumber === stepNumber);
        if (!step) return;
        
        step.endTime = performance.now();
        step.duration = step.endTime - step.startTime;
        step.status = success ? 'completed' : 'failed';
        
        if (result) {
            step.data = { ...step.data, result };
        }
        
        const icon = success ? '✓' : '✗';
        this.log(
            success ? 'step' : 'error',
            `[${stepNumber}] ${icon} ${step.name} (${step.duration.toFixed(2)}ms)`,
            result
        );
    }

    /**
     * 跳过步骤
     */
    skipStep(stepNumber: number, reason: string): void {
        const context = this.getCurrentContext();
        if (!context) return;
        
        const step = context.steps.find(s => s.stepNumber === stepNumber);
        if (!step) return;
        
        step.status = 'skipped';
        step.endTime = performance.now();
        step.duration = 0;
        step.error = reason;
        
        this.log('warn', `[${stepNumber}] ⊘ ${step.name} (跳过: ${reason})`);
    }

    /**
     * 记录日志
     */
    log(level: LogLevel, message: string, data?: any): void {
        const context = this.getCurrentContext();
        const stepNumber = context?.currentStep || null;
        
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            stepNumber,
            message,
            data
        };
        
        // 添加到上下文日志
        if (context) {
            context.logs.push(entry);
        }
        
        // 控制台输出
        const prefix = this.getLevelPrefix(level);
        const stepPrefix = stepNumber ? `[Step ${stepNumber}] ` : '';
        
        switch (level) {
            case 'error':
                console.error(`${prefix} ${stepPrefix}${message}`, data || '');
                break;
            case 'warn':
                console.warn(`${prefix} ${stepPrefix}${message}`, data || '');
                break;
            case 'debug':
                console.debug(`${prefix} ${stepPrefix}${message}`, data || '');
                break;
            default:
                console.log(`${prefix} ${stepPrefix}${message}`, data || '');
        }
        
        // 发送到 Agent
        if (this.logCallback) {
            try {
                this.logCallback(entry);
            } catch (e) {
                console.error('[ExecutionLogger] 日志回调失败:', e);
            }
        }
    }

    /**
     * 记录错误
     */
    logError(error: Error | string, context?: any): void {
        const errorMessage = error instanceof Error 
            ? `${error.name}: ${error.message}`
            : error;
        
        const errorData = error instanceof Error
            ? { 
                name: error.name,
                message: error.message,
                stack: error.stack,
                context
              }
            : { message: error, context };
        
        this.log('error', `🔴 错误: ${errorMessage}`, errorData);
    }

    /**
     * 记录性能数据
     */
    logPerf(label: string, durationMs: number, details?: any): void {
        let perfLevel: string;
        if (durationMs < 100) {
            perfLevel = '🟢';  // 快
        } else if (durationMs < 1000) {
            perfLevel = '🟡';  // 中等
        } else {
            perfLevel = '🔴';  // 慢
        }
        
        this.log('perf', `${perfLevel} ${label}: ${durationMs.toFixed(2)}ms`, details);
    }

    /**
     * 获取当前上下文
     */
    private getCurrentContext(): ExecutionContext | null {
        if (!this.currentContextId) return null;
        return this.contexts.get(this.currentContextId) || null;
    }

    /**
     * 获取日志级别前缀
     */
    private getLevelPrefix(level: LogLevel): string {
        switch (level) {
            case 'debug': return '🔍';
            case 'info': return 'ℹ️';
            case 'warn': return '⚠️';
            case 'error': return '❌';
            case 'step': return '📌';
            case 'perf': return '⏱️';
            default: return '';
        }
    }

    /**
     * 输出步骤摘要
     */
    private logStepsSummary(context: ExecutionContext): void {
        console.log('\n📊 步骤执行摘要:');
        console.log('┌────────┬────────────────────────────────┬──────────┬──────────┐');
        console.log('│ 步骤   │ 名称                           │ 状态     │ 耗时     │');
        console.log('├────────┼────────────────────────────────┼──────────┼──────────┤');
        
        for (const step of context.steps) {
            const numStr = String(step.stepNumber).padStart(2, ' ');
            const name = step.name.substring(0, 30).padEnd(30, ' ');
            const status = this.getStatusIcon(step.status).padEnd(8, ' ');
            const duration = step.duration !== undefined 
                ? `${step.duration.toFixed(0)}ms`.padStart(8, ' ')
                : '    -   ';
            
            console.log(`│ ${numStr}     │ ${name} │ ${status} │ ${duration} │`);
        }
        
        console.log('└────────┴────────────────────────────────┴──────────┴──────────┘');
    }

    /**
     * 获取状态图标
     */
    private getStatusIcon(status: ExecutionStep['status']): string {
        switch (status) {
            case 'completed': return '✅ 完成';
            case 'failed': return '❌ 失败';
            case 'skipped': return '⊘ 跳过';
            case 'started': return '🔄 进行中';
            default: return status;
        }
    }

    /**
     * 获取任务日志
     */
    getTaskLogs(taskId: string): LogEntry[] {
        const context = this.contexts.get(taskId);
        return context?.logs || [];
    }

    /**
     * 导出任务报告
     */
    exportTaskReport(taskId: string): string {
        const context = this.contexts.get(taskId);
        if (!context) return '';
        
        const totalDuration = context.steps.reduce((sum, s) => sum + (s.duration || 0), 0);
        
        let report = `
═══════════════════════════════════════════════════════════
                    任务执行报告
═══════════════════════════════════════════════════════════

任务名称: ${context.taskName}
任务ID: ${context.taskId}
开始时间: ${new Date(context.startTime).toISOString()}
总步骤数: ${context.steps.length}
总耗时: ${totalDuration.toFixed(2)}ms

───────────────────────────────────────────────────────────
                    步骤详情
───────────────────────────────────────────────────────────
`;
        
        for (const step of context.steps) {
            report += `
[${step.stepNumber}] ${step.name}
    状态: ${step.status}
    耗时: ${step.duration?.toFixed(2) || '-'}ms
    ${step.error ? `错误: ${step.error}` : ''}
    ${step.data ? `数据: ${JSON.stringify(step.data, null, 2)}` : ''}
`;
        }
        
        report += `
───────────────────────────────────────────────────────────
                    错误日志
───────────────────────────────────────────────────────────
`;
        
        const errors = context.logs.filter(l => l.level === 'error');
        if (errors.length === 0) {
            report += '无错误\n';
        } else {
            for (const error of errors) {
                report += `[${error.timestamp}] ${error.message}\n`;
                if (error.data) {
                    report += `    ${JSON.stringify(error.data, null, 2)}\n`;
                }
            }
        }
        
        return report;
    }
}

// 导出单例
export const executionLogger = new ExecutionLogger();

// 便捷函数
export function startTask(taskName: string, metadata?: Record<string, any>): string {
    return executionLogger.startTask(taskName, metadata);
}

export function endTask(taskId?: string, success?: boolean): ExecutionContext | null {
    return executionLogger.endTask(taskId, success);
}

export function startStep(stepName: string, data?: any): number {
    return executionLogger.startStep(stepName, data);
}

export function endStep(stepNumber: number, success?: boolean, result?: any): void {
    executionLogger.endStep(stepNumber, success, result);
}

export function logInfo(message: string, data?: any): void {
    executionLogger.log('info', message, data);
}

export function logDebug(message: string, data?: any): void {
    executionLogger.log('debug', message, data);
}

export function logWarn(message: string, data?: any): void {
    executionLogger.log('warn', message, data);
}

export function logError(error: Error | string, context?: any): void {
    executionLogger.logError(error, context);
}

export function logPerf(label: string, durationMs: number, details?: any): void {
    executionLogger.logPerf(label, durationMs, details);
}
