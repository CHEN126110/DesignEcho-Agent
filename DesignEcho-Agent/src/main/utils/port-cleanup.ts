import { execSync } from 'child_process';

/**
 * 清理占用指定端口的进程（仅限 Windows）
 */
export function killProcessOnPort(port: number): boolean {
    if (process.env.DESIGNECHO_ALLOW_PORT_CLEANUP !== '1') {
        console.log(`[Main] 端口清理默认关闭。如需主动释放端口 ${port}，请显式设置 DESIGNECHO_ALLOW_PORT_CLEANUP=1`);
        return false;
    }

    if (process.platform !== 'win32') {
        console.log('[Main] 端口清理仅支持 Windows');
        return false;
    }

    try {
        // 查找占用端口的进程 PID
        const result = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf-8' });
        const lines = result.split('\n').filter((line) => line.includes('LISTENING'));

        if (lines.length === 0) {
            console.log(`[Main] 端口 ${port} 未被占用`);
            return true;
        }

        // 提取 PID 并终止进程
        const pids = new Set<string>();
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
                pids.add(pid);
            }
        }

        for (const pid of pids) {
            try {
                execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
                console.log(`[Main] 已终止占用端口 ${port} 的进程 (PID: ${pid})`);
            } catch {
                // 进程可能已经退出
                console.log(`[Main] 进程 ${pid} 可能已退出`);
            }
        }

        return true;
    } catch (error: any) {
        // 如果命令失败，可能是端口没有被占用
        if (error.status === 1) {
            console.log(`[Main] 端口 ${port} 未被占用`);
            return true;
        }
        console.error('[Main] 端口清理失败:', error.message);
        return false;
    }
}
