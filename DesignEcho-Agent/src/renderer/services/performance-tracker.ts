/**
 * 性能追踪服务
 * 
 * 记录各个步骤的耗时，用于性能分析和优化
 */

// ==================== 类型定义 ====================

export interface TimingRecord {
    /** 步骤名称 */
    name: string;
    /** 开始时间戳 */
    startTime: number;
    /** 结束时间戳 */
    endTime?: number;
    /** 耗时（毫秒） */
    duration?: number;
    /** 父级步骤 */
    parent?: string;
    /** 元数据 */
    meta?: Record<string, any>;
}

export interface PerformanceReport {
    /** 会话 ID */
    sessionId: string;
    /** 用户输入 */
    userInput: string;
    /** 开始时间 */
    startTime: number;
    /** 总耗时 */
    totalDuration: number;
    /** 各步骤耗时 */
    timings: TimingRecord[];
    /** 耗时摘要 */
    summary: {
        promptBuild: number;
        modelCall: number;
        decisionParse: number;
        skillExecution: number;
        toolExecution: number;
        other: number;
    };
}

function getDurationStatusIcon(duration: number): string {
    if (duration > 3000) {
        return '🐢';
    }
    if (duration > 1000) {
        return '⚠';
    }
    return '✓';
}

// ==================== 性能追踪器 ====================

class PerformanceTracker {
    private currentSession: {
        id: string;
        userInput: string;
        startTime: number;
        timings: TimingRecord[];
    } | null = null;
    
    private activeTimers: Map<string, TimingRecord> = new Map();
    
    /**
     * 开始新的追踪会话
     */
    startSession(userInput: string): string {
        const sessionId = `perf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        
        this.currentSession = {
            id: sessionId,
            userInput,
            startTime: Date.now(),
            timings: []
        };
        
        this.activeTimers.clear();
        
        console.log(`[⏱️ Perf] ========== 开始会话 ${sessionId} ==========`);
        console.log(`[⏱️ Perf] 用户输入: "${userInput.substring(0, 50)}${userInput.length > 50 ? '...' : ''}"`);
        
        return sessionId;
    }
    
    /**
     * 开始计时
     */
    start(name: string, meta?: Record<string, any>): void {
        if (!this.currentSession) return;
        
        const record: TimingRecord = {
            name,
            startTime: Date.now(),
            meta
        };
        
        this.activeTimers.set(name, record);
        console.log(`[⏱️ Perf] ▶ ${name} 开始${meta ? ` (${JSON.stringify(meta)})` : ''}`);
    }
    
    /**
     * 结束计时
     */
    end(name: string, meta?: Record<string, any>): number {
        if (!this.currentSession) return 0;
        
        const record = this.activeTimers.get(name);
        if (!record) {
            console.warn(`[⏱️ Perf] ⚠ 未找到计时器: ${name}`);
            return 0;
        }
        
        record.endTime = Date.now();
        record.duration = record.endTime - record.startTime;
        if (meta) {
            record.meta = { ...record.meta, ...meta };
        }
        
        this.currentSession.timings.push(record);
        this.activeTimers.delete(name);
        
        const durationStr = formatDuration(record.duration);
        const statusIcon = getDurationStatusIcon(record.duration);
        console.log(`[⏱️ Perf] ${statusIcon} ${name} 完成: ${durationStr}${meta ? ` (${JSON.stringify(meta)})` : ''}`);
        
        return record.duration;
    }
    
    /**
     * 快速计时（包装异步函数）
     */
    async time<T>(name: string, fn: () => Promise<T>, meta?: Record<string, any>): Promise<T> {
        this.start(name, meta);
        try {
            const result = await fn();
            this.end(name);
            return result;
        } catch (error) {
            this.end(name, { error: true });
            throw error;
        }
    }
    
    /**
     * 结束会话并生成报告
     */
    endSession(): PerformanceReport | null {
        if (!this.currentSession) return null;
        
        const totalDuration = Date.now() - this.currentSession.startTime;
        
        // 计算各类耗时摘要
        const summary = {
            promptBuild: 0,
            modelCall: 0,
            decisionParse: 0,
            skillExecution: 0,
            toolExecution: 0,
            other: 0
        };
        
        for (const timing of this.currentSession.timings) {
            const duration = timing.duration || 0;
            const name = timing.name.toLowerCase();
            
            if (name.includes('prompt') || name.includes('构建')) {
                summary.promptBuild += duration;
            } else if (name.includes('model') || name.includes('ai') || name.includes('模型')) {
                summary.modelCall += duration;
            } else if (name.includes('parse') || name.includes('解析')) {
                summary.decisionParse += duration;
            } else if (name.includes('skill') || name.includes('技能')) {
                summary.skillExecution += duration;
            } else if (name.includes('tool') || name.includes('工具')) {
                summary.toolExecution += duration;
            } else {
                summary.other += duration;
            }
        }
        
        const report: PerformanceReport = {
            sessionId: this.currentSession.id,
            userInput: this.currentSession.userInput,
            startTime: this.currentSession.startTime,
            totalDuration,
            timings: this.currentSession.timings,
            summary
        };
        
        // 打印报告
        this.printReport(report);
        
        this.currentSession = null;
        this.activeTimers.clear();
        
        return report;
    }
    
    /**
     * 打印性能报告
     */
    private printReport(report: PerformanceReport): void {
        console.log(`[⏱️ Perf] ========== 性能报告 ==========`);
        console.log(`[⏱️ Perf] 📊 总耗时: ${formatDuration(report.totalDuration)}`);
        console.log(`[⏱️ Perf] 📋 步骤分解:`);
        
        // 按耗时排序
        const sortedTimings = [...report.timings].sort((a, b) => (b.duration || 0) - (a.duration || 0));
        
        for (const timing of sortedTimings) {
            const percent = report.totalDuration > 0 
                ? ((timing.duration || 0) / report.totalDuration * 100).toFixed(1)
                : '0';
            const bar = createProgressBar(Number(percent));
            console.log(`[⏱️ Perf]   ${bar} ${timing.name}: ${formatDuration(timing.duration || 0)} (${percent}%)`);
        }
        
        console.log(`[⏱️ Perf] 📈 分类摘要:`);
        const categories = [
            { name: '模型调用', value: report.summary.modelCall, icon: '🤖' },
            { name: '技能执行', value: report.summary.skillExecution, icon: '⚡' },
            { name: '工具执行', value: report.summary.toolExecution, icon: '🔧' },
            { name: '提示词构建', value: report.summary.promptBuild, icon: '📝' },
            { name: '决策解析', value: report.summary.decisionParse, icon: '🔍' },
            { name: '其他', value: report.summary.other, icon: '📦' }
        ];
        
        for (const cat of categories) {
            if (cat.value > 0) {
                const percent = report.totalDuration > 0 
                    ? (cat.value / report.totalDuration * 100).toFixed(1)
                    : '0';
                console.log(`[⏱️ Perf]   ${cat.icon} ${cat.name}: ${formatDuration(cat.value)} (${percent}%)`);
            }
        }
        
        // 性能建议
        if (report.summary.modelCall > 5000) {
            console.log(`[⏱️ Perf] 💡 建议: 模型调用耗时较长，考虑使用更快的模型或流式输出`);
        }
        if (report.summary.promptBuild > 1000) {
            console.log(`[⏱️ Perf] 💡 建议: 提示词构建耗时较长，检查是否有不必要的上下文`);
        }
        
        console.log(`[⏱️ Perf] =====================================`);
    }
    
    /**
     * 获取当前会话的实时耗时
     */
    getCurrentDuration(): number {
        if (!this.currentSession) return 0;
        return Date.now() - this.currentSession.startTime;
    }
    
    /**
     * 检查是否有活跃会话
     */
    hasActiveSession(): boolean {
        return this.currentSession !== null;
    }
}

// ==================== 辅助函数 ====================

/**
 * 格式化耗时显示
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(2)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(1);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * 创建进度条
 */
function createProgressBar(percent: number, length: number = 10): string {
    const filled = Math.round(percent / 100 * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// ==================== 导出单例 ====================

export const perfTracker = new PerformanceTracker();

// 便捷函数
export const startPerfSession = (userInput: string) => perfTracker.startSession(userInput);
export const startTiming = (name: string, meta?: Record<string, any>) => perfTracker.start(name, meta);
export const endTiming = (name: string, meta?: Record<string, any>) => perfTracker.end(name, meta);
export const timeFn = <T>(name: string, fn: () => Promise<T>, meta?: Record<string, any>) => perfTracker.time(name, fn, meta);
export const endPerfSession = () => perfTracker.endSession();

export default perfTracker;
