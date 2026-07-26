/**
 * Agent 用户可见回复的单一呈现契约。
 *
 * 这里不决定任务路线、执行状态或完成事实，只约束模型如何组织已有信息，
 * 并在展示旧消息时恢复被供应商压平的明确编号边界。
 */

export const AGENT_RESPONSE_PRESENTATION_PROMPT = [
    '用户可见回复的结构由信息量决定，不套固定模板。',
    '一两句话能说明白时直接回答，不添加空洞标题。',
    '当回复包含三个以上并列要点、多个阶段或一份完整说明时，使用 Markdown 形成清楚层级：简短标题、必要的导语、编号小节和项目符号；需要收束时可在分隔线后给出结论。',
    '标题、段落和列表之间保留空行；禁止把“1. … 2. … 3. …”等多个编号挤在同一行。',
    '结构化只用于组织表达，不改变事实，不补造执行结果，也不暴露内部工具、路由、状态码或调试过程。'
].join('\n');

interface InlineNumberedMarker {
    index: number;
    end: number;
    number: number;
}

function collectInlineNumberedMarkers(line: string): InlineNumberedMarker[] {
    const markers: InlineNumberedMarker[] = [];
    const pattern = /(?:^|[ \t]+)(\d{1,2})[.、)]\s*(?=[「“"【(\u3400-\u9fffA-Za-z])/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
        markers.push({
            index: match.index,
            end: pattern.lastIndex,
            number: Number(match[1])
        });
    }
    return markers;
}

function isSequentialNumberedRun(markers: InlineNumberedMarker[]): boolean {
    if (markers.length < 3 || markers[0].number !== 1) return false;
    return markers.every((marker, index) => marker.number === index + 1);
}

function restoreInlineNumberedRun(line: string): string {
    const markers = collectInlineNumberedMarkers(line);
    if (!isSequentialNumberedRun(markers)) return line;

    const intro = line.slice(0, markers[0].index).trim();
    const items = markers.map((marker, index) => {
        const nextIndex = markers[index + 1]?.index ?? line.length;
        const content = line.slice(marker.end, nextIndex).trim();
        return `${marker.number}. ${content}`.trimEnd();
    });
    if (items.some((item) => item.replace(/^\d+\.\s*/u, '').length < 2)) return line;

    return [intro, intro ? '' : null, ...items]
        .filter((item): item is string => item !== null)
        .join('\n');
}

function restoreInlineBulletRun(line: string): string {
    const markerCount = (line.match(/(?:^|[ \t]+)•\s*(?=[\u3400-\u9fffA-Za-z])/gu) || []).length;
    if (markerCount < 3) return line;
    const firstMarkerIndex = line.search(/(?:^|[ \t]+)•\s*(?=[\u3400-\u9fffA-Za-z])/u);
    if (firstMarkerIndex < 0) return line;

    const intro = line.slice(0, firstMarkerIndex).trim();
    const listText = line.slice(firstMarkerIndex).trim();
    const items = listText
        .split('•')
        .map((item) => item.trim())
        .filter(Boolean);
    if (items.length < 3 || items.some((item) => item.length < 2)) return line;
    return [intro, intro ? '' : null, ...items.map((item) => `- ${item}`)]
        .filter((item): item is string => item !== null)
        .join('\n');
}

/**
 * 只恢复明确的展示边界，不改写词句或持久化内容。
 * 为避免把版本号、尺寸或小数误判成列表，仅接受从 1 开始、至少三项且连续的编号。
 */
export function normalizeAgentResponsePresentation(content: string): string {
    const normalized = String(content || '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) return '';
    return normalized
        .split('\n')
        .map(restoreInlineNumberedRun)
        .map(restoreInlineBulletRun)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function isStructuredAgentResponseContent(content: string): boolean {
    const value = String(content || '');
    if (!value) return false;
    return /(^|\n)\s{0,3}#{1,3}\s+\S/u.test(value)
        || /(^|\n)\s*(?:[-*]\s+|\d{1,2}[.、)]\s+)\S/u.test(value)
        || /(^|\n)\s*(?:---+|\*\*\*)\s*(?:\n|$)/u.test(value)
        || /\|[^\n]+\|\n\s*\|?\s*:?-{2,}/u.test(value);
}
