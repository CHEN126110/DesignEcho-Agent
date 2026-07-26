/**
 * 日志服务
 * 
 * 接收来自 UXP 插件的日志，保存到文件中
 * 便于开发调试时查看插件运行状态
 * 
 * 特性：
 * - 分类日志文件（主日志、错误日志）
 * - 过滤心跳/连接状态重复日志
 * - 终端同步输出
 * - 错误统计和分类
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** 日志分类 */
export type LogCategory = 
    | 'general'      // 通用日志
    | 'tool'         // 工具调用
    | 'export'       // 导出操作
    | 'connection'   // 连接状态
    | 'error'        // 错误
    | 'ai';          // AI 相关

export interface LogEntry {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: any;
    source: 'UXP' | 'Agent';
    category?: LogCategory;
}

/** 错误统计 */
interface ErrorStats {
    total: number;
    byType: Map<string, number>;
    recent: Array<{ timestamp: string; message: string; type: string }>;
}

// 日志过滤配置
interface LogFilterConfig {
    /** 过滤心跳消息 */
    filterHeartbeat: boolean;
    /** 连接状态只显示一次 */
    deduplicateConnectionStatus: boolean;
    /** 过滤的消息模式 */
    filteredPatterns: RegExp[];
}

export class LogService {
    private logDir: string;
    private logFilePath: string;
    private errorLogPath: string;
    private maxFileSize: number = 10 * 1024 * 1024; // 10MB，超过后清空重写
    private maxLineLength: number = 64 * 1024; // 单条日志最大长度，防止超大字符串导致进程崩溃
    private maxSerializedDataLength: number = 16 * 1024; // DATA 字段最大序列化长度
    private writeStream: fs.WriteStream | null = null;
    private errorStream: fs.WriteStream | null = null;
    private buffer: string[] = [];
    private errorBuffer: string[] = [];
    private flushInterval: ReturnType<typeof setInterval> | null = null;
    private initialized: boolean = false;
    
    // 连接状态跟踪
    private lastConnectionState: 'connected' | 'disconnected' | 'unknown' = 'unknown';
    private heartbeatLoggedOnce: boolean = false;
    
    // 错误统计
    private errorStats: ErrorStats = {
        total: 0,
        byType: new Map(),
        recent: []
    };
    
    // 过滤配置
    private filterConfig: LogFilterConfig = {
        filterHeartbeat: true,
        deduplicateConnectionStatus: true,
        filteredPatterns: [
            /\[MessageHandler\] 通知: pong/,
            /ping.*timestamp/i,
            /pong.*timestamp/i,
            /"method":\s*"ping"/,
            /"method":\s*"pong"/,
            /serverAlive.*true/,
        ]
    };

    constructor(logFileName: string = 'uxp-debug.log') {
        // 日志文件保存在应用数据目录或当前工作目录
        this.logDir = process.env.NODE_ENV === 'development'
            ? path.join(process.cwd(), 'logs')
            : path.join(app.getPath('userData'), 'logs');

        // 确保日志目录存在
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.logFilePath = path.join(this.logDir, logFileName);
        this.errorLogPath = path.join(this.logDir, 'errors.log');
    }

    /**
     * 初始化日志服务
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // 检查文件大小，超过限制则清空
            await this.truncateIfNeeded(this.logFilePath);
            await this.truncateIfNeeded(this.errorLogPath);

            // 打开主日志写入流（追加模式）
            this.writeStream = fs.createWriteStream(this.logFilePath, {
                flags: 'a',
                encoding: 'utf8'
            });

            // 打开错误日志写入流
            this.errorStream = fs.createWriteStream(this.errorLogPath, {
                flags: 'a',
                encoding: 'utf8'
            });

            // 写入启动标记
            const startLine = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] DesignEcho Agent 启动\n${'='.repeat(60)}\n`;
            this.writeStream.write(startLine);
            this.errorStream.write(startLine);

            // 定期刷新缓冲区
            this.flushInterval = setInterval(() => {
                this.flush();
            }, 1000);

            this.initialized = true;
            this.writeToFile('info', `[LogService] 日志目录: ${this.logDir}`, 'Agent');
            this.writeToFile('info', `[LogService] 主日志: ${this.logFilePath}`, 'Agent');
            this.writeToFile('info', `[LogService] 错误日志: ${this.errorLogPath}`, 'Agent');

        } catch (error) {
            this.writeToFile('error', `[LogService] 初始化失败: ${this.argToString(error)}`, 'Agent');
        }
    }

    /**
     * 检查并截断日志文件（超过大小限制时清空）
     */
    private async truncateIfNeeded(filePath: string): Promise<void> {
        try {
            if (!fs.existsSync(filePath)) return;

            const stats = fs.statSync(filePath);
            if (stats.size >= this.maxFileSize) {
                this.writeToFile(
                    'warn',
                    `[LogService] 日志文件超过 ${this.maxFileSize / 1024 / 1024}MB，清空重写: ${filePath}`,
                    'Agent'
                );
                fs.writeFileSync(filePath, `[${new Date().toISOString()}] 日志文件已清空（超过大小限制）\n`);
            }
        } catch (error) {
            this.writeToFile('error', `[LogService] 截断检查失败: ${this.argToString(error)}`, 'Agent');
        }
    }

    /**
     * 判断是否应该过滤此日志
     */
    private shouldFilter(entry: LogEntry): boolean {
        const message = entry.message;
        const dataStr = entry.data !== undefined ? this.getDataPreview(entry.data, 1024) : '';
        const fullContent = message + dataStr;

        // 检查是否是心跳消息
        if (this.filterConfig.filterHeartbeat) {
            for (const pattern of this.filterConfig.filteredPatterns) {
                if (pattern.test(fullContent)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 记录日志
     */
    log(entry: LogEntry): void {
        // 检查是否应该过滤
        if (this.shouldFilter(entry)) {
            return; // 静默过滤
        }

        // 自动识别日志分类
        if (!entry.category) {
            entry.category = this.categorizeLog(entry);
        }

        const line = this.formatLogLine(entry);
        this.buffer.push(line);

        // 错误日志同时写入错误日志文件
        if (entry.level === 'error' || entry.level === 'warn') {
            this.errorBuffer.push(line);
            this.trackError(entry);
        }

        // 如果缓冲区太大，立即刷新
        if (this.buffer.length > 50) {
            this.flush();
        }

        // 同时输出到控制台（带颜色）
        this.consoleOutput(entry);
    }
    
    /**
     * 自动识别日志分类
     */
    private categorizeLog(entry: LogEntry): LogCategory {
        const msg = entry.message.toLowerCase();
        const data = entry.data !== undefined ? this.getDataPreview(entry.data, 512).toLowerCase() : '';
        const content = msg + data;
        
        // 错误类
        if (entry.level === 'error') return 'error';
        if (content.includes('error') || content.includes('失败') || content.includes('could not find')) return 'error';
        
        // 导出类
        if (content.includes('export') || content.includes('导出') || content.includes('getentry')) return 'export';
        
        // 工具调用
        if (content.includes('tool') || content.includes('工具') || content.includes('skulayout')) return 'tool';
        
        // 连接类
        if (content.includes('connect') || content.includes('连接') || content.includes('websocket')) return 'connection';
        
        // AI 类
        if (content.includes('ai') || content.includes('model') || content.includes('模型')) return 'ai';
        
        return 'general';
    }
    
    /**
     * 追踪错误统计
     */
    private trackError(entry: LogEntry): void {
        this.errorStats.total++;
        
        // 识别错误类型
        const errorType = this.identifyErrorType(entry.message);
        const count = this.errorStats.byType.get(errorType) || 0;
        this.errorStats.byType.set(errorType, count + 1);
        
        // 保存最近的错误（最多100条）
        this.errorStats.recent.push({
            timestamp: entry.timestamp,
            message: entry.message,
            type: errorType
        });
        if (this.errorStats.recent.length > 100) {
            this.errorStats.recent.shift();
        }
    }
    
    /**
     * 识别错误类型
     */
    private identifyErrorType(message: string): string {
        const msg = message.toLowerCase();
        
        if (msg.includes('could not find an entry') || msg.includes('getentry')) {
            return 'FILE_NOT_FOUND';
        }
        if (msg.includes('authorization') || msg.includes('授权')) {
            return 'AUTHORIZATION';
        }
        if (msg.includes('websocket') || msg.includes('connection')) {
            return 'CONNECTION';
        }
        if (msg.includes('timeout') || msg.includes('超时')) {
            return 'TIMEOUT';
        }
        if (msg.includes('photoshop') || msg.includes('uxp')) {
            return 'PHOTOSHOP';
        }
        if (msg.includes('model') || msg.includes('ai')) {
            return 'AI_MODEL';
        }
        
        return 'UNKNOWN';
    }

    /**
     * 记录来自 UXP 的日志
     */
    logFromUXP(entry: LogEntry): void {
        entry.source = 'UXP';
        this.log(entry);
    }

    /**
     * 记录 Agent 自身的日志
     */
    logAgent(level: LogEntry['level'], message: string, data?: any): void {
        this.log({
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            source: 'Agent'
        });
    }
    
    /**
     * 记录连接状态变化（只在状态变化时记录）
     */
    logConnectionStatus(connected: boolean, details?: string): void {
        const newState = connected ? 'connected' : 'disconnected';
        
        // 只在状态变化时记录
        if (this.filterConfig.deduplicateConnectionStatus && this.lastConnectionState === newState) {
            return;
        }
        
        this.lastConnectionState = newState;
        
        const message = connected 
            ? `✅ UXP 插件已连接${details ? ` - ${details}` : ''}`
            : `❌ UXP 插件已断开${details ? ` - ${details}` : ''}`;
        
        this.logAgent(connected ? 'info' : 'warn', message);
    }
    
    /**
     * 记录心跳状态（只记录一次）
     */
    logHeartbeatOnce(): void {
        if (this.heartbeatLoggedOnce) return;
        this.heartbeatLoggedOnce = true;
        this.logAgent('debug', '💓 心跳机制已启动');
    }
    
    /**
     * 重置心跳日志状态（连接断开时调用）
     */
    resetHeartbeatLog(): void {
        this.heartbeatLoggedOnce = false;
    }

    /**
     * 格式化日志行
     */
    private formatLogLine(entry: LogEntry): string {
        const levelPadded = entry.level.toUpperCase().padEnd(5);
        const source = `[${entry.source}]`.padEnd(7);
        const category = entry.category ? `[${entry.category}]`.padEnd(12) : '';
        let line = `[${entry.timestamp}] ${levelPadded} ${source} ${category} ${this.truncateString(entry.message, this.maxLineLength / 2)}`;

        if (entry.data !== undefined) {
            try {
                const dataStr = this.serializeData(entry.data, this.maxSerializedDataLength);
                line += `\n  DATA: ${dataStr}`;
            } catch {
                line += `\n  DATA: [无法序列化]`;
            }
        }

        return this.ensureLineLength(line + '\n');
    }
    
    /**
     * 获取错误统计
     */
    getErrorStats(): { 
        total: number; 
        byType: Record<string, number>; 
        recent: Array<{ timestamp: string; message: string; type: string }>;
    } {
        return {
            total: this.errorStats.total,
            byType: Object.fromEntries(this.errorStats.byType),
            recent: [...this.errorStats.recent]
        };
    }
    
    /**
     * 获取按分类筛选的日志
     */
    getLogsByCategory(category: LogCategory, lines: number = 50): string {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                return '日志文件不存在';
            }

            const content = fs.readFileSync(this.logFilePath, 'utf8');
            const allLines = content.split('\n');
            const filtered = allLines.filter(line => 
                line.toLowerCase().includes(`[${category}]`)
            );
            return filtered.slice(-lines).join('\n');

        } catch (error) {
            return `读取日志失败: ${error}`;
        }
    }
    
    /**
     * 获取错误日志
     */
    getErrorLogs(lines: number = 50): string {
        try {
            if (!fs.existsSync(this.errorLogPath)) {
                return '错误日志文件不存在';
            }

            const content = fs.readFileSync(this.errorLogPath, 'utf8');
            const allLines = content.split('\n');
            return allLines.slice(-lines).join('\n');

        } catch (error) {
            return `读取错误日志失败: ${error}`;
        }
    }
    
    /**
     * 获取日志目录路径
     */
    getLogDir(): string {
        return this.logDir;
    }

    /**
     * 输出到控制台（使用原始 console 避免被拦截导致重复）
     */
    private consoleOutput(_entry: LogEntry): void {
        // Desktop runtime may not have a stable stdout/stderr pipe.
        // Keep a single logging path (file) to avoid EPIPE crashes.
    }

    /**
     * 刷新缓冲区
     */
    private flush(): void {
        // 刷新主日志
        if (this.buffer.length > 0 && this.writeStream) {
            const lines = this.buffer;
            this.buffer = [];
            try {
                for (const line of lines) {
                    this.writeStream.write(line);
                }
            } catch (error) {
                this.writeToFile('error', `[LogService] 主日志写入失败: ${this.argToString(error)}`, 'Agent');
            }
        }
        
        // 刷新错误日志
        if (this.errorBuffer.length > 0 && this.errorStream) {
            const lines = this.errorBuffer;
            this.errorBuffer = [];
            try {
                for (const line of lines) {
                    this.errorStream.write(line);
                }
            } catch (error) {
                this.writeToFile('error', `[LogService] 错误日志写入失败: ${this.argToString(error)}`, 'Agent');
            }
        }
    }

    /**
     * 获取日志文件路径
     */
    getLogFilePath(): string {
        return this.logFilePath;
    }

    /**
     * 获取最近的日志内容
     */
    getRecentLogs(lines: number = 100): string {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                return '日志文件不存在';
            }

            const content = fs.readFileSync(this.logFilePath, 'utf8');
            const allLines = content.split('\n');
            const recentLines = allLines.slice(-lines);
            return recentLines.join('\n');

        } catch (error) {
            return `读取日志失败: ${error}`;
        }
    }

    /**
     * 清空日志文件
     */
    clearLogs(): void {
        try {
            this.flush();

            if (this.writeStream) {
                this.writeStream.end();
                this.writeStream = null;
            }

            fs.writeFileSync(this.logFilePath, '');

            // 重新打开流
            this.writeStream = fs.createWriteStream(this.logFilePath, {
                flags: 'a',
                encoding: 'utf8'
            });

            const clearLine = `[${new Date().toISOString()}] 日志已清空\n`;
            this.writeStream.write(clearLine);

            this.writeToFile('info', '[LogService] 日志已清空', 'Agent');

        } catch (error) {
            this.writeToFile('error', `[LogService] 清空日志失败: ${this.argToString(error)}`, 'Agent');
        }
    }

    /**
     * 关闭日志服务
     */
    async close(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        this.flush();

        const endLine = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] DesignEcho Agent 关闭\n${'='.repeat(60)}\n`;

        if (this.writeStream) {
            this.writeStream.write(endLine);
            this.writeStream.end();
            this.writeStream = null;
        }
        
        if (this.errorStream) {
            this.errorStream.write(endLine);
            this.errorStream.end();
            this.errorStream = null;
        }

        this.initialized = false;
        this.lastConnectionState = 'unknown';
        this.heartbeatLoggedOnce = false;

        this.writeToFile('info', '[LogService] 日志服务已关闭', 'Agent');
    }

    // 保存原始 console 方法
    private originalConsole = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug?.bind(console) || console.log.bind(console)
    };
    private consoleIntercepted = false;

    /**
     * 拦截 console 输出并写入日志文件
     * 调用后，所有 console.log/warn/error/debug 都会同时写入日志文件
     */
    interceptConsole(): void {
        if (this.consoleIntercepted) return;

        const self = this;

        console.log = (...args: any[]) => {
            const message = args.map(a => self.argToString(a)).join(' ');
            self.writeToFile('info', message, 'Agent');
        };

        console.warn = (...args: any[]) => {
            const message = args.map(a => self.argToString(a)).join(' ');
            self.writeToFile('warn', message, 'Agent');
        };

        console.error = (...args: any[]) => {
            const message = args.map(a => self.argToString(a)).join(' ');
            self.writeToFile('error', message, 'Agent');
        };

        console.debug = (...args: any[]) => {
            const message = args.map(a => self.argToString(a)).join(' ');
            self.writeToFile('debug', message, 'Agent');
        };

        this.consoleIntercepted = true;
        this.writeToFile('info', '[LogService] Console 输出已拦截，所有日志将写入文件', 'Agent');
    }

    /**
     * 直接写入日志文件（不输出到终端）
     */
    private writeToFile(level: LogEntry['level'], message: string, source: 'UXP' | 'Agent'): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message: this.truncateString(message, this.maxLineLength / 2),
            source
        };
        
        // 检查是否应该过滤
        if (this.shouldFilter(entry)) {
            return;
        }
        
        const line = this.formatLogLine(entry);
        this.buffer.push(line);

        // 如果缓冲区太大，立即刷新
        if (this.buffer.length > 50) {
            this.flush();
        }
    }

    /**
     * 将任意参数转为安全字符串（避免循环引用/超大对象）
     */
    private argToString(value: any): string {
        if (value === undefined) return 'undefined';
        if (value === null) return 'null';
        if (typeof value === 'string') return this.truncateString(value, this.maxSerializedDataLength);
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
        if (value instanceof Error) return value.stack || value.message;
        return this.serializeData(value, this.maxSerializedDataLength);
    }

    /**
     * 获取用于过滤/分类的短预览
     */
    private getDataPreview(data: any, maxChars: number): string {
        return this.serializeData(data, maxChars);
    }

    /**
     * 安全序列化 data，主动截断超长字符串，防止日志爆内存
     */
    private serializeData(data: any, maxChars: number): string {
        if (data === undefined) return '';
        if (typeof data === 'string') return this.truncateString(data, maxChars);
        if (Buffer.isBuffer(data)) return `[Buffer length=${data.length}]`;
        if (data instanceof Uint8Array) return `[Uint8Array length=${data.length}]`;

        try {
            const replacer = (_key: string, value: any) => {
                if (typeof value === 'string') {
                    return this.truncateString(value, Math.max(1024, Math.floor(maxChars / 4)));
                }
                if (Buffer.isBuffer(value)) {
                    return `[Buffer length=${value.length}]`;
                }
                if (value instanceof Uint8Array) {
                    return `[Uint8Array length=${value.length}]`;
                }
                if (Array.isArray(value) && value.length > 100) {
                    return [...value.slice(0, 100), `...[+${value.length - 100} items]`];
                }
                return value;
            };
            const json = JSON.stringify(data, replacer, 2);
            if (!json) return String(data);
            return this.truncateString(json, maxChars);
        } catch {
            return '[无法序列化]';
        }
    }

    /**
     * 截断字符串，避免超大日志导致崩溃
     */
    private truncateString(input: string, maxChars: number): string {
        if (!input || input.length <= maxChars) return input;
        return `${input.slice(0, maxChars)}...[TRUNCATED ${input.length - maxChars} chars]`;
    }

    /**
     * 最后一道长度保护，保证单行日志长度不会失控
     */
    private ensureLineLength(line: string): string {
        if (line.length <= this.maxLineLength) return line;
        return `${line.slice(0, this.maxLineLength)}\n[LogService] line truncated (originalLength=${line.length})\n`;
    }

    /**
     * 恢复原始 console 方法
     */
    restoreConsole(): void {
        if (!this.consoleIntercepted) return;

        console.log = this.originalConsole.log;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.debug = this.originalConsole.debug;

        this.consoleIntercepted = false;
        this.writeToFile('info', '[LogService] Console 输出已恢复', 'Agent');
    }
}

// 导出单例
let logServiceInstance: LogService | null = null;

export function getLogService(): LogService {
    if (!logServiceInstance) {
        logServiceInstance = new LogService();
    }
    return logServiceInstance;
}
