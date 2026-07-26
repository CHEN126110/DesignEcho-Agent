/**
 * 工具调用日志服务
 * 
 * 记录详细的工具调用信息，便于调试和问题定位
 */

export interface ToolCallLog {
    id: string;
    timestamp: Date;
    toolName: string;
    params: any;
    result: any;
    success: boolean;
    duration: number;
    error?: string;
    round: number;
}

export interface SessionLog {
    sessionId: string;
    startTime: Date;
    endTime?: Date;
    userInput: string;
    toolCalls: ToolCallLog[];
    modelUsed: string;
    totalRounds: number;
    finalResponse?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    errorMessage?: string;
}

function getSessionStatusIcon(status: SessionLog['status']): string {
    if (status === 'completed') {
        return '✅';
    }
    if (status === 'cancelled') {
        return '⏹️';
    }
    if (status === 'failed') {
        return '❌';
    }
    return 'ℹ️';
}

function getToolResultSummary(result: any): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    if (typeof result.acceptance?.summaryText === 'string') {
        return result.acceptance.summaryText;
    }
    if (typeof result.message === 'string') {
        return result.message.length > 160 ? `${result.message.slice(0, 160)}...` : result.message;
    }
    if (typeof result.error === 'string') {
        return `错误: ${result.error}`;
    }
    return undefined;
}

function getToolAcceptanceDebugText(result: any): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    return typeof result.acceptance?.debugText === 'string' ? result.acceptance.debugText : undefined;
}

function summarizeParamsForReport(params: any): string {
    if (!params || typeof params !== 'object') return String(params ?? '');
    const keys = Object.keys(params).slice(0, 12);
    if (keys.length === 0) return '{}';
    return keys.map((key) => {
        const value = params[key];
        if (value === null || value === undefined) return `${key}=空`;
        if (typeof value === 'string') {
            if (/key|token|secret|password/i.test(key)) return `${key}=<已隐藏>`;
            if (/path|file|dir|url/i.test(key)) return `${key}=<${value.split(/[\\/]/).pop() || '路径'}>`;
            return `${key}=${value.length > 40 ? `${value.slice(0, 40)}...` : value}`;
        }
        if (typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`;
        if (Array.isArray(value)) return `${key}=数组(${value.length})`;
        return `${key}=对象`;
    }).join(', ');
}

class ToolLoggerService {
    private currentSession: SessionLog | null = null;
    private sessionHistory: SessionLog[] = [];
    private maxHistorySize = 20;
    private listeners: Set<(log: SessionLog) => void> = new Set();
    private debugMode = false;

    /**
     * 开启/关闭调试模式
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        console.log(`[ToolLogger] 调试模式: ${enabled ? '开启' : '关闭'}`);
    }

    isDebugMode(): boolean {
        return this.debugMode;
    }

    /**
     * 开始新会话
     */
    startSession(userInput: string): string {
        const sessionId = `session_${Date.now()}`;
        this.currentSession = {
            sessionId,
            startTime: new Date(),
            userInput,
            toolCalls: [],
            modelUsed: '',
            totalRounds: 0,
            status: 'running'
        };
        
        if (this.debugMode) {
            console.log(`[ToolLogger] 📝 开始新会话: ${sessionId}`);
            console.log(`[ToolLogger] 用户输入: ${userInput.substring(0, 100)}...`);
        }
        
        this.notifyListeners();
        return sessionId;
    }

    /**
     * 记录工具调用
     */
    logToolCall(
        toolName: string, 
        params: any, 
        result: any, 
        duration: number,
        round: number
    ): ToolCallLog {
        const log: ToolCallLog = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            toolName,
            params,
            result,
            success: result?.success !== false,
            duration,
            error: result?.error,
            round
        };

        if (this.currentSession) {
            this.currentSession.toolCalls.push(log);
            this.currentSession.totalRounds = Math.max(this.currentSession.totalRounds, round);
        }

        if (this.debugMode) {
            const statusIcon = log.success ? '✅' : '❌';
            console.log(`[ToolLogger] ${statusIcon} 工具调用: ${toolName}`);
            console.log(`  参数:`, JSON.stringify(params, null, 2).substring(0, 200));
            console.log(`  耗时: ${duration}ms`);
            if (!log.success) {
                console.log(`  错误: ${log.error}`);
            } else {
                console.log(`  结果预览:`, JSON.stringify(result, null, 2).substring(0, 300));
            }
        }

        this.notifyListeners();
        return log;
    }

    /**
     * 设置使用的模型
     */
    setModelUsed(modelId: string): void {
        if (this.currentSession) {
            this.currentSession.modelUsed = modelId;
            if (this.debugMode) {
                console.log(`[ToolLogger] 🤖 使用模型: ${modelId}`);
            }
        }
    }

    /**
     * 结束会话
     */
    endSession(status: 'completed' | 'failed' | 'cancelled', finalResponse?: string, errorMessage?: string): void {
        if (this.currentSession) {
            this.currentSession.endTime = new Date();
            this.currentSession.status = status;
            this.currentSession.finalResponse = finalResponse;
            this.currentSession.errorMessage = errorMessage;

            // 保存到历史
            this.sessionHistory.unshift(this.currentSession);
            if (this.sessionHistory.length > this.maxHistorySize) {
                this.sessionHistory.pop();
            }

            if (this.debugMode) {
                const duration = this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime();
                const statusIcon = getSessionStatusIcon(status);
                console.log(`[ToolLogger] ${statusIcon} 会话结束: ${status}`);
                console.log(`  总耗时: ${duration}ms`);
                console.log(`  工具调用次数: ${this.currentSession.toolCalls.length}`);
                console.log(`  成功率: ${this.getSuccessRate()}%`);
                if (errorMessage) {
                    console.log(`  错误: ${errorMessage}`);
                }
            }

            this.notifyListeners();
            this.currentSession = null;
        }
    }

    /**
     * 获取当前会话
     */
    getCurrentSession(): SessionLog | null {
        return this.currentSession;
    }

    /**
     * 获取历史会话
     */
    getSessionHistory(): SessionLog[] {
        return this.sessionHistory;
    }

    /**
     * 获取当前会话的成功率
     */
    getSuccessRate(): number {
        if (!this.currentSession || this.currentSession.toolCalls.length === 0) {
            return 100;
        }
        const successCount = this.currentSession.toolCalls.filter(c => c.success).length;
        return Math.round((successCount / this.currentSession.toolCalls.length) * 100);
    }

    /**
     * 获取失败的工具调用
     */
    getFailedCalls(): ToolCallLog[] {
        if (!this.currentSession) return [];
        return this.currentSession.toolCalls.filter(c => !c.success);
    }

    /**
     * 生成调试报告
     */
    generateDebugReport(): string {
        const session = this.currentSession || this.sessionHistory[0];
        if (!session) {
            return '暂无会话数据';
        }

        let report = `📊 **调试报告**\n\n`;
        report += `**会话信息**\n`;
        report += `- ID: ${session.sessionId}\n`;
        report += `- 状态: ${session.status}\n`;
        report += `- 模型: ${session.modelUsed || '未知'}\n`;
        report += `- 轮次: ${session.totalRounds}\n`;
        
        if (session.endTime) {
            const duration = session.endTime.getTime() - session.startTime.getTime();
            report += `- 总耗时: ${duration}ms\n`;
        }
        
        report += `\n**工具调用 (${session.toolCalls.length} 次)**\n`;
        
        session.toolCalls.forEach((call, index) => {
            const icon = call.success ? '✅' : '❌';
            report += `${index + 1}. ${icon} ${call.toolName} (${call.duration}ms)\n`;
            const summary = getToolResultSummary(call.result);
            if (summary) {
                report += `   摘要: ${summary}\n`;
            }
            const acceptanceDebug = getToolAcceptanceDebugText(call.result);
            if (acceptanceDebug) {
                report += `   ${acceptanceDebug}\n`;
            }
            if (!call.success) {
                report += `   错误: ${call.error}\n`;
            }
        });

        const failedCalls = session.toolCalls.filter(c => !c.success);
        if (failedCalls.length > 0) {
            report += `\n**失败详情**\n`;
            failedCalls.forEach(call => {
                report += `- ${call.toolName}: ${call.error}\n`;
                report += `  参数摘要: ${summarizeParamsForReport(call.params)}\n`;
            });
        }

        if (session.errorMessage) {
            report += `\n**会话错误**\n${session.errorMessage}\n`;
        }

        return report;
    }

    /**
     * 订阅日志更新
     */
    subscribe(callback: (log: SessionLog) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private notifyListeners(): void {
        if (this.currentSession) {
            this.listeners.forEach(cb => cb(this.currentSession!));
        }
    }

    /**
     * 清除历史
     */
    clearHistory(): void {
        this.sessionHistory = [];
    }
}

// 单例
export const toolLogger = new ToolLoggerService();
export default toolLogger;
