/**
 * 模型输出 JSON 容错提取
 *
 * 视觉/文本模型返回的 JSON 常见三类损伤：
 * 1. 包在 ```json 代码围栏里；
 * 2. 字符串值里有非法转义（典型：Windows 路径反斜杠 `images\详情页_01.jpg` 直接进了 JSON）；
 * 3. 尾随逗号。
 * 裸 JSON.parse 会直接抛错（实测错误：Bad escaped character in JSON），导致整次分析作废。
 * 这里按「围栏剥离 → 括号配平提取 → 裸解析 → 非法转义修复 → 尾随逗号修复」逐级降级，
 * 全部失败时返回 undefined（诚实失败，不伪造结果）。
 *
 * 注意：提取使用括号配平扫描而不是正则——非贪婪正则会截断嵌套对象，
 * 贪婪正则会把多个对象连同中间文本一起吞掉（教训同 design-team-verdict）。
 */

export interface ExtractedModelJson {
    value: any;
    /** true 表示原文不是合法 JSON，经过了转义/逗号修复 */
    repaired: boolean;
}

function stripCodeFences(text: string): string {
    return text.replace(/```(?:json|JSON)?\s*([\s\S]*?)```/g, '$1');
}

/** 括号配平扫描：返回所有顶层 {...} 候选（含字符串内花括号的正确跳过） */
function scanBalancedObjects(text: string): string[] {
    const candidates: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) {
                    candidates.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
        }
    }
    // 字符串内非法转义会破坏 inString 状态机；扫描失败时退回贪婪截取作最后候选
    if (candidates.length === 0) {
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first >= 0 && last > first) {
            candidates.push(text.slice(first, last + 1));
        }
    }
    return candidates;
}

/** 修复字符串值中的非法转义：`\` 后不是 JSON 合法转义字符时补成 `\\` */
function repairInvalidEscapes(jsonText: string): string {
    return jsonText.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

/** 去掉对象/数组的尾随逗号 */
function repairTrailingCommas(jsonText: string): string {
    return jsonText.replace(/,\s*([}\]])/g, '$1');
}

export function extractModelJsonObject(text: unknown): ExtractedModelJson | undefined {
    const raw = stripCodeFences(String(text ?? ''));
    if (!raw.trim()) return undefined;

    for (const candidate of scanBalancedObjects(raw)) {
        try {
            return { value: JSON.parse(candidate), repaired: false };
        } catch {
            // 继续降级修复
        }
        const escapeRepaired = repairInvalidEscapes(candidate);
        try {
            return { value: JSON.parse(escapeRepaired), repaired: true };
        } catch {
            // 继续降级修复
        }
        try {
            return { value: JSON.parse(repairTrailingCommas(escapeRepaired)), repaired: true };
        } catch {
            // 当前候选无法修复，尝试下一个候选
        }
    }
    return undefined;
}
