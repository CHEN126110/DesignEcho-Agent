/**
 * Agent Run Record 持久化 IPC（Harness v1 · H1）
 *
 * 存储位置：<projectPath>/.designecho/runs/<runId>.json（UTF-8 无 BOM，原子写）
 * 记录组装在 shared/agent-run-record.ts（纯逻辑，可测）；本层只做 IO：
 *  - 写入前过 validateAgentRunRecordForPersist（版本/runId/边界/体积/无图像字节）
 *  - tmp + rename 原子写（与 design-state.json 同模式）
 *  - 按数量修剪：只保留最近 MAX_RUN_FILES 条，防目录无限膨胀
 * 失败返回具体原因；调用方（执行器边缘）fire-and-forget，绝不影响任务结果。
 */

import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
    attachRepositoryArtifactRefsToRunRecord,
    matchesAgentRunRecordRepositoryProjection,
    validateAgentRunRecordForPersist,
    type AgentRunRecord
} from '../../shared/agent-run-record';
import { artifactRepositoryService } from '../services/artifact-repository-service';

const MAX_RUN_FILES = 50;

function resolveRunsDir(projectPath: string): string {
    return path.join(projectPath, '.designecho', 'runs');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function hasRendererArtifactAuthority(record: unknown): boolean {
    if (!isRecord(record)) return false;
    const boundaries = isRecord(record.boundaries) ? record.boundaries : undefined;
    return hasOwn(record, 'artifactRefs')
        || hasOwn(record, 'droppedArtifactRefCount')
        || Boolean(boundaries && hasOwn(boundaries, 'artifactRefsFromRepositoryOnly'));
}

function canonicalExistingDirectory(value: unknown): string | undefined {
    const candidate = String(value || '').trim();
    if (!candidate) return undefined;
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return undefined;
    return fs.realpathSync(resolved);
}

function sameProjectPath(left: string, right: string): boolean {
    const comparableLeft = process.platform === 'win32' ? left.toLowerCase() : left;
    const comparableRight = process.platform === 'win32' ? right.toLowerCase() : right;
    return comparableLeft === comparableRight;
}

function pruneOldRunFiles(runsDir: string): number {
    try {
        const files = fs.readdirSync(runsDir)
            .filter((name) => name.startsWith('run-') && name.endsWith('.json'))
            .map((name) => {
                const filePath = path.join(runsDir, name);
                return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
        const excess = files.slice(MAX_RUN_FILES);
        for (const item of excess) {
            fs.unlinkSync(item.filePath);
        }
        return excess.length;
    } catch {
        return 0; // 修剪失败不阻塞写入
    }
}

export function registerRunRecordHandlers(): void {
    ipcMain.handle('agentRun:writeRecord', async (_event, record: unknown, projectPath: unknown) => {
        const targetProject = String(projectPath || '').trim();
        if (!targetProject) {
            return { success: false, error: '写入运行记录失败：未提供项目路径（无项目的运行不持久化）' };
        }
        const canonicalTargetProject = canonicalExistingDirectory(targetProject);
        if (!canonicalTargetProject) {
            return { success: false, error: `写入运行记录失败：项目路径不存在（${targetProject}）` };
        }
        if (hasRendererArtifactAuthority(record)) {
            return {
                success: false,
                error: '写入运行记录失败：Renderer 不得提交 artifactRefs、droppedArtifactRefCount 或 Repository authority 边界。'
            };
        }
        const validation = validateAgentRunRecordForPersist(record);
        if (!validation.ok) {
            return { success: false, error: `写入运行记录失败：记录校验不通过——${validation.reason}` };
        }
        const baseRecord = record as AgentRunRecord;
        const canonicalRecordProject = canonicalExistingDirectory(baseRecord.projectPath);
        if (!canonicalRecordProject || !sameProjectPath(canonicalTargetProject, canonicalRecordProject)) {
            return { success: false, error: '写入运行记录失败：记录 projectPath 与目标项目不一致。' };
        }

        let recordToPersist = baseRecord;
        if (baseRecord.runtimeSession) {
            try {
                const projection = await artifactRepositoryService.readProjection(canonicalTargetProject, {
                    sessionId: baseRecord.runtimeSession.sessionId,
                    runId: baseRecord.runtimeSession.runId,
                    generation: baseRecord.runtimeSession.generation
                });
                recordToPersist = attachRepositoryArtifactRefsToRunRecord(baseRecord, projection);
            } catch (error: any) {
                console.warn(
                    `[AgentRun] Artifact Repository refs 未附加，本次只保存基础运行档案：${error?.message || String(error)}`
                );
            }
        }
        const finalValidation = validateAgentRunRecordForPersist(recordToPersist);
        if (!finalValidation.ok) {
            return { success: false, error: `写入运行记录失败：Repository 接线后二次校验不通过——${finalValidation.reason}` };
        }

        const runId = recordToPersist.runId;
        const runsDir = resolveRunsDir(canonicalTargetProject);
        try {
            fs.mkdirSync(runsDir, { recursive: true });
            const file = path.join(runsDir, `${runId}.json`);
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(recordToPersist, null, 2), { encoding: 'utf8' });
            fs.renameSync(tmp, file);
            const pruned = pruneOldRunFiles(runsDir);
            return { success: true, filePath: file, pruned };
        } catch (error: any) {
            return { success: false, error: `写入运行记录失败：${error?.message || String(error)}（目录：${runsDir}）` };
        }
    });

    ipcMain.handle('agentRun:listRecords', async (_event, projectPath: unknown, limit?: unknown) => {
        const targetProject = String(projectPath || '').trim();
        if (!targetProject) return { success: false, error: '未提供项目路径', records: [] };
        const canonicalTargetProject = canonicalExistingDirectory(targetProject);
        if (!canonicalTargetProject) {
            return { success: false, error: `读取运行记录失败：项目路径不存在（${targetProject}）`, records: [] };
        }
        const runsDir = resolveRunsDir(canonicalTargetProject);
        if (!fs.existsSync(runsDir)) return { success: true, records: [] };
        const cap = Math.max(1, Math.min(Number(limit) || 20, MAX_RUN_FILES));
        try {
            const files = fs.readdirSync(runsDir)
                .filter((name) => name.startsWith('run-') && name.endsWith('.json'))
                .map((name) => {
                    const filePath = path.join(runsDir, name);
                    return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);
            const records: AgentRunRecord[] = [];
            for (const item of files) {
                if (records.length >= cap) break;
                try {
                    const candidate = JSON.parse(fs.readFileSync(item.filePath, 'utf8')) as unknown;
                    const validation = validateAgentRunRecordForPersist(candidate);
                    if (!validation.ok) continue;
                    const record = candidate as AgentRunRecord;
                    const canonicalRecordProject = canonicalExistingDirectory(record.projectPath);
                    if (!canonicalRecordProject
                        || !sameProjectPath(canonicalTargetProject, canonicalRecordProject)) {
                        continue;
                    }
                    if (hasOwn(record, 'artifactRefs')) {
                        if (!record.runtimeSession) continue;
                        const projection = await artifactRepositoryService.readProjection(canonicalTargetProject, {
                            sessionId: record.runtimeSession.sessionId,
                            runId: record.runtimeSession.runId,
                            generation: record.runtimeSession.generation
                        });
                        if (!matchesAgentRunRecordRepositoryProjection(record, projection)) continue;
                    }
                    records.push(record);
                } catch {
                    // 解析失败、路径失配或 Repository 不可验证时 fail closed，不返回该档案。
                }
            }
            return { success: true, records };
        } catch (error: any) {
            return { success: false, error: `读取运行记录失败：${error?.message || String(error)}`, records: [] };
        }
    });
}
