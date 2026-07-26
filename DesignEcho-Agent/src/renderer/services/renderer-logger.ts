/**
 * 渲染器日志服务
 * 
 * 将渲染器进程的日志转发到主进程，以便写入日志文件
 * 同时保持原有的 console 输出功能
 * 
 * 使用方式：
 * import { rendererLogger } from './renderer-logger';
 * rendererLogger.info('[Agent] 技能匹配结果', data);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogOptions {
    /** 是否也输出到 console（默认 true） */
    consoleOutput?: boolean;
    /** 附加数据 */
    data?: any;
}

class RendererLogger {
    private prefix: string = '[Renderer]';
    private enabled: boolean = true;
    
    /**
     * 发送日志到主进程
     */
    private async sendToMain(level: LogLevel, message: string, data?: any): Promise<void> {
        if (!this.enabled) return;
        
        try {
            // 通过 preload 暴露的 writeLog 方法发送到主进程
            if (window.designEcho?.writeLog) {
                await window.designEcho.writeLog(level as 'info' | 'warn' | 'error', message, data);
            }
        } catch (e) {
            // 静默失败，避免日志错误导致更多问题
        }
    }
    
    /**
     * 格式化消息
     */
    private formatMessage(message: string, ...args: any[]): string {
        const parts = [message];
        for (const arg of args) {
            if (typeof arg === 'object') {
                try {
                    parts.push(JSON.stringify(arg, null, 2));
                } catch {
                    parts.push(String(arg));
                }
            } else {
                parts.push(String(arg));
            }
        }
        return parts.join(' ');
    }
    
    /**
     * 调试日志
     */
    debug(message: string, ...args: any[]): void {
        const formatted = this.formatMessage(message, ...args);
        console.debug(formatted);
        this.sendToMain('debug', formatted);
    }
    
    /**
     * 信息日志
     */
    info(message: string, ...args: any[]): void {
        const formatted = this.formatMessage(message, ...args);
        console.log(formatted);
        this.sendToMain('info', formatted);
    }
    
    /**
     * 警告日志
     */
    warn(message: string, ...args: any[]): void {
        const formatted = this.formatMessage(message, ...args);
        console.warn(formatted);
        this.sendToMain('warn', formatted);
    }
    
    /**
     * 错误日志
     */
    error(message: string, ...args: any[]): void {
        const formatted = this.formatMessage(message, ...args);
        console.error(formatted);
        this.sendToMain('error', formatted);
    }
    
    /**
     * 启用/禁用日志
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    
    /**
     * 创建带前缀的子日志器
     */
    withPrefix(prefix: string): {
        debug: (message: string, ...args: any[]) => void;
        info: (message: string, ...args: any[]) => void;
        warn: (message: string, ...args: any[]) => void;
        error: (message: string, ...args: any[]) => void;
    } {
        return {
            debug: (message: string, ...args: any[]) => this.debug(`${prefix} ${message}`, ...args),
            info: (message: string, ...args: any[]) => this.info(`${prefix} ${message}`, ...args),
            warn: (message: string, ...args: any[]) => this.warn(`${prefix} ${message}`, ...args),
            error: (message: string, ...args: any[]) => this.error(`${prefix} ${message}`, ...args),
        };
    }
}

// 单例导出
export const rendererLogger = new RendererLogger();

// 创建专用日志器
export const agentLogger = rendererLogger.withPrefix('[Agent]');
export const skillLogger = rendererLogger.withPrefix('[SkillMatch]');
export const contextLogger = rendererLogger.withPrefix('[Context]');

export default rendererLogger;
