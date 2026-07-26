import type {
    MinimalDesignElement,
    MinimalDesignElementStyle,
    MinimalDesignRepresentation
} from './reference-replication';
import { buildReferenceLayoutStructure } from './reference-replication-layout-structure';
import {
    resolveReferenceReplicationOutputIntent,
    type ReferenceReplicationOutputIntent
} from './reference-replication-output-intent';

export interface TemplateBlueprintTextLayout {
    rowId?: string;
    columnId?: string;
    columnZone?: 'left' | 'center' | 'right';
    textAlign?: 'left' | 'center' | 'right';
    rowStep?: number;
}

export interface TemplateBlueprintElement {
    role: 'copy' | 'icon' | 'image' | 'background' | 'decoration' | 'unknown';
    sourceElementId?: string;
    name: string;
    content?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    style?: MinimalDesignElementStyle;
    textLayout?: TemplateBlueprintTextLayout;
}

export interface TemplateBlueprintScreen {
    index: number;
    type: string;
    label: string;
    groups: Array<'文案' | 'icon' | '图片'>;
    elements: TemplateBlueprintElement[];
}

export interface ReferenceReplicationBlueprint {
    version: 'reference-replication-blueprint/v1';
    outputIntent: ReferenceReplicationOutputIntent;
    layoutType: string;
    screens: TemplateBlueprintScreen[];
}

function clamp01(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function normalizeBlueprintRole(rawType: string, name: string): TemplateBlueprintElement['role'] {
    const typeText = String(rawType || '').toLowerCase();
    const nameText = String(name || '').toLowerCase();
    if (/title|subtitle|text|copy|文案|标题|说明/.test(typeText) || /title|subtitle|text|copy|文案|标题|说明/.test(nameText)) return 'copy';
    if (/icon|badge|label|tag|图标|标签/.test(typeText) || /icon|badge|label|tag|图标|标签/.test(nameText)) return 'icon';
    if (/image|photo|product|model|hero|kv|picture|图片|主图|模特/.test(typeText) || /image|photo|product|model|hero|kv|picture|图片|主图|模特/.test(nameText)) return 'image';
    if (/background|bg|背景/.test(typeText) || /background|bg|背景/.test(nameText)) return 'background';
    if (/decoration|shape|line|装饰|图形/.test(typeText) || /decoration|shape|line|装饰|图形/.test(nameText)) return 'decoration';
    return 'unknown';
}

function guessDetailScreenType(text: string): string {
    const normalized = text.toLowerCase();
    if (/营销|活动|优惠|促销|discount|campaign/.test(normalized)) return '营销信息';
    if (/信任|背书|品牌|认证|award|trust/.test(normalized)) return '信任状/品牌背书';
    if (/首屏|hero|kv|banner|主视觉/.test(normalized)) return '详情页首屏';
    if (/icon|图标|标签|卖点/.test(normalized)) return '图标icon';
    if (/颜色|款式|配色|color|variant/.test(normalized)) return '颜色款式展示';
    if (/面料|材质|fabric|material/.test(normalized)) return '面料';
    if (/痛点|问题|解决|pain|solution/.test(normalized)) return '解决痛点问题';
    if (/穿搭|搭配|outfit|styling/.test(normalized)) return '穿搭推荐';
    if (/参数|规格|尺码|spec|size/.test(normalized)) return '产品参数';
    if (/细节|工艺|detail|closeup/.test(normalized)) return '细节展示';
    return '自定义模块';
}

function groupForBlueprintRole(role: TemplateBlueprintElement['role']): '文案' | 'icon' | '图片' {
    if (role === 'copy') return '文案';
    if (role === 'icon') return 'icon';
    return '图片';
}

function groupsForElements(elements: TemplateBlueprintElement[]): Array<'文案' | 'icon' | '图片'> {
    const groups = new Set<'文案' | 'icon' | '图片'>();
    for (const element of elements) {
        groups.add(groupForBlueprintRole(element.role));
    }
    return Array.from(groups);
}

export function normalizeTemplateBlueprintScreenGroups(
    screen: Partial<Pick<TemplateBlueprintScreen, 'groups'>>
): Array<'文案' | 'icon' | '图片'> {
    const allowed = new Set(['文案', 'icon', '图片']);
    if (!Array.isArray(screen?.groups)) {
        return [];
    }

    return screen.groups.filter((group): group is '文案' | 'icon' | '图片' => allowed.has(group));
}

function normalizeTemplateBlueprintElements(
    representation: MinimalDesignRepresentation
): TemplateBlueprintElement[] {
    const rawElements = Array.isArray(representation?.elements) ? representation.elements : [];
    const layoutStructure = buildReferenceLayoutStructure(representation);
    const rowByElementId = new Map<string, string>();
    const columnByElementId = new Map<string, {
        id: string;
        zone: TemplateBlueprintTextLayout['columnZone'];
        textAlign: TemplateBlueprintTextLayout['textAlign'];
    }>();
    for (const row of layoutStructure.rowGroups) {
        for (const elementId of row.elementIds) {
            rowByElementId.set(elementId, row.id);
        }
    }
    for (const column of layoutStructure.columnGroups) {
        for (const elementId of column.elementIds) {
            columnByElementId.set(elementId, {
                id: column.id,
                zone: column.zone,
                textAlign: column.textAlign
            });
        }
    }

    return rawElements
        .map((element: MinimalDesignElement, index) => {
            const x = clamp01(Number(element?.box?.x), 0.5);
            const y = clamp01(Number(element?.box?.y), 0.5);
            const width = clamp01(Number(element?.box?.width), 0.2);
            const height = clamp01(Number(element?.box?.height), 0.1);
            const name = String(element?.name || `${element?.sourceType || 'element'}_${index + 1}`);
            const column = columnByElementId.get(element.id);
            return {
                role: normalizeBlueprintRole(String(element?.sourceType || ''), name),
                sourceElementId: element.id,
                name,
                content: typeof element?.content === 'string' ? element.content : undefined,
                x,
                y,
                width,
                height,
                style: element.style,
                textLayout: element.nodeKind === 'text' ? {
                    rowId: rowByElementId.get(element.id),
                    columnId: column?.id,
                    columnZone: column?.zone,
                    textAlign: column?.textAlign,
                    rowStep: layoutStructure.rhythm.medianRowStep || undefined
                } : undefined
            } satisfies TemplateBlueprintElement;
        })
        .sort((a, b) => a.y - b.y);
}

export function buildReferenceReplicationBlueprint(
    representation: MinimalDesignRepresentation,
    outputIntent: ReferenceReplicationOutputIntent
): ReferenceReplicationBlueprint {
    const normalized = normalizeTemplateBlueprintElements(representation);
    const layoutType = String(representation?.layout?.layoutType || 'unknown');

    if (normalized.length === 0) {
        return {
            version: 'reference-replication-blueprint/v1',
            outputIntent,
            layoutType,
            screens: []
        };
    }

    if (outputIntent.topology === 'single_canvas') {
        return {
            version: 'reference-replication-blueprint/v1',
            outputIntent,
            layoutType,
            screens: [{
                index: 1,
                type: outputIntent.artifactLabel,
                label: outputIntent.surfaceLabel,
                groups: normalizeTemplateBlueprintScreenGroups({
                    groups: groupsForElements(normalized)
                }),
                elements: normalized
            }]
        };
    }

    const screens: TemplateBlueprintScreen[] = [];
    const gapThreshold = 0.12;
    let cluster: TemplateBlueprintElement[] = [];
    let anchorY = normalized[0].y;

    const flushCluster = (items: TemplateBlueprintElement[]) => {
        if (items.length === 0) return;
        const textBlob = items.map(item => `${item.name} ${item.content || ''}`).join(' ');
        const type = guessDetailScreenType(textBlob);
        screens.push({
            index: screens.length + 1,
            type,
            label: `第${screens.length + 1}屏_${type}`,
            groups: normalizeTemplateBlueprintScreenGroups({ groups: groupsForElements(items) }),
            elements: items
        });
    };

    for (const element of normalized) {
        if (cluster.length === 0) {
            cluster.push(element);
            anchorY = element.y;
            continue;
        }

        if (Math.abs(element.y - anchorY) > gapThreshold) {
            flushCluster(cluster);
            cluster = [element];
            anchorY = element.y;
            continue;
        }

        cluster.push(element);
        anchorY = (anchorY + element.y) / 2;
    }

    flushCluster(cluster);

    return {
        version: 'reference-replication-blueprint/v1',
        outputIntent,
        layoutType,
        screens
    };
}

export function buildDetailTemplateBlueprint(
    representation: MinimalDesignRepresentation
): ReferenceReplicationBlueprint {
    return buildReferenceReplicationBlueprint(
        representation,
        resolveReferenceReplicationOutputIntent({ artifactKind: 'detail-page' })
    );
}
