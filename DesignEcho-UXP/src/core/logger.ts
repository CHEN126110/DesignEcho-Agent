/**
 * UXP 日志收集器
 * 
 * 拦截 console 方法，将日志发送到 Agent
 * 便于开发调试时查看 UXP 插件的运行状态
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: any;
    source: 'UXP';
}

type LogCallback = (entry: LogEntry) => void;

class Logger {
    private static instance: Logger;
    private callback: LogCallback | null = null;
    private originalConsole: {
        log: typeof console.log;
        info: typeof console.info;
        warn: typeof console.warn;
        error: typeof console.error;
        debug: typeof console.debug;
    };
    private enabled: boolean = false;
    private buffer: LogEntry[] = [];
    private maxBufferSize: number = 100;

    private constructor() {
        // 保存原始 console 方法
        this.originalConsole = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            debug: console.debug.bind(console)
        };
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 启用日志拦截
     */
    enable(callback?: LogCallback): void {
        if (this.enabled) return;

        this.enabled = true;
        if (callback) {
            this.callback = callback;
        }

        // 拦截 console 方法
        console.log = (...args: any[]) => {
            this.originalConsole.log(...args);
            this.capture('info', args);
        };

        console.info = (...args: any[]) => {
            this.originalConsole.info(...args);
            this.capture('info', args);
        };

        console.warn = (...args: any[]) => {
            this.originalConsole.warn(...args);
            this.capture('warn', args);
        };

        console.error = (...args: any[]) => {
            this.originalConsole.error(...args);
            this.capture('error', args);
        };

        console.debug = (...args: any[]) => {
            this.originalConsole.debug(...args);
            this.capture('debug', args);
        };

        this.originalConsole.log('[Logger] 日志收集已启用');
    }

    /**
     * 禁用日志拦截
     */
    disable(): void {
        if (!this.enabled) return;

        this.enabled = false;

        // 恢复原始 console 方法
        console.log = this.originalConsole.log;
        console.info = this.originalConsole.info;
        console.warn = this.originalConsole.warn;
        console.error = this.originalConsole.error;
        console.debug = this.originalConsole.debug;

        this.originalConsole.log('[Logger] 日志收集已禁用');
    }

    /**
     * 设置日志回调
     */
    setCallback(callback: LogCallback): void {
        this.callback = callback;

        // 发送缓冲区中的日志
        if (this.buffer.length > 0) {
            this.buffer.forEach(entry => callback(entry));
            this.buffer = [];
        }
    }

    /**
     * 清除回调
     */
    clearCallback(): void {
        this.callback = null;
    }

    /**
     * 捕获日志
     */
    private capture(level: LogLevel, args: any[]): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message: this.formatArgs(args),
            data: args.length > 1 ? args.slice(1) : undefined,
            source: 'UXP'
        };

        if (this.callback) {
            try {
                this.callback(entry);
            } catch (e) {
                this.originalConsole.error('[Logger] 回调执行失败:', e);
            }
        } else {
            // 如果没有回调，先缓存日志
            this.buffer.push(entry);
            if (this.buffer.length > this.maxBufferSize) {
                this.buffer.shift();
            }
        }
    }

    /**
     * 格式化参数
     */
    private formatArgs(args: any[]): string {
        return args.map(arg => {
            if (typeof arg === 'string') {
                return arg;
            }
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
            }
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }).join(' ');
    }

    /**
     * 手动记录日志（不通过 console）
     */
    log(level: LogLevel, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            source: 'UXP'
        };

        // 输出到原始 console
        const consoleMethod = level === 'error' ? this.originalConsole.error
            : level === 'warn' ? this.originalConsole.warn
            : level === 'debug' ? this.originalConsole.debug
            : this.originalConsole.log;

        consoleMethod(`[${level.toUpperCase()}]`, message, data || '');

        if (this.callback) {
            this.callback(entry);
        } else {
            this.buffer.push(entry);
            if (this.buffer.length > this.maxBufferSize) {
                this.buffer.shift();
            }
        }
    }

    /**
     * 获取缓冲区日志
     */
    getBuffer(): LogEntry[] {
        return [...this.buffer];
    }

    /**
     * 清空缓冲区
     */
    clearBuffer(): void {
        this.buffer = [];
    }
}

// 导出单例
export const logger = Logger.getInstance();

// 便捷方法
export function enableLogging(callback?: LogCallback): void {
    logger.enable(callback);
}

export function disableLogging(): void {
    logger.disable();
}

export function setLogCallback(callback: LogCallback): void {
    logger.setCallback(callback);
}
