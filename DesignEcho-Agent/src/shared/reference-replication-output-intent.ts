import type { DesignDomainConceptId } from './design-domain-knowledge';
import type { DesignDocumentRole } from './design-document-role';
import type { DesignAgentOsScenario } from './design-agent-os-contracts';

export type ReferenceReplicationArtifactKind =
    | Extract<DesignDomainConceptId, 'poster' | 'banner' | 'main-image' | 'detail-page'>
    | 'generic';

export type ReferenceReplicationOutputTopology = 'single_canvas' | 'multi_screen';

export interface ReferenceReplicationOutputIntent {
    version: 'reference-replication-output-intent/v1';
    artifactKind: ReferenceReplicationArtifactKind;
    artifactLabel: string;
    topology: ReferenceReplicationOutputTopology;
    documentRole: DesignDocumentRole;
    documentName: string;
    rootGroupPrefix: string;
    surfaceLabel: string;
    surfaceUnit: '版面' | '屏';
    canvasProfile: 'reference-replication' | 'detail-template';
    fallbackCanvas: {
        width: number;
        height: number;
    };
    autoFillStrategy: 'none' | 'detail-page';
}

function parseReferenceReplicationArtifactKind(
    value: unknown
): ReferenceReplicationArtifactKind | undefined {
    const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
    if (!normalized) return undefined;
    if (normalized === 'poster') return 'poster';
    if (normalized === 'banner') return 'banner';
    if (normalized === 'main-image' || normalized === 'mainimage') return 'main-image';
    if (normalized === 'detail-page' || normalized === 'detailpage') return 'detail-page';
    if (normalized === 'generic' || normalized === 'reference') return 'generic';
    return undefined;
}

export function normalizeReferenceReplicationArtifactKind(
    value: unknown
): ReferenceReplicationArtifactKind {
    return parseReferenceReplicationArtifactKind(value) || 'generic';
}

function artifactKindFromDeliverableText(value: unknown): ReferenceReplicationArtifactKind {
    const text = String(value || '').trim().toLowerCase();
    if (/海报|宣传图|活动图|poster/i.test(text)) return 'poster';
    if (/banner|横幅|店铺头图|活动横幅/i.test(text)) return 'banner';
    if (/主图|首图|点击图|转化图|白底图|main[\s-]*image|hero[\s-]*image/i.test(text)) return 'main-image';
    if (/详情页|商品详情|产品详情|详情长图|商品长图|卖点页|detail[\s-]*page/i.test(text)) return 'detail-page';
    return 'generic';
}

/**
 * 只识别用户句子里高置信度的「直接交付物」。
 *
 * 参考任务经常同时出现来源与目标，例如「参考详情页做海报」。不能用最后出现的
 * 品类或模型补充参数覆盖这里的目标；模型 artifactKind 只负责补充用户没有明确
 * 说出交付物的请求。
 */
function inferExplicitReferenceReplicationDeliverableKind(
    userIntent: unknown
): ReferenceReplicationArtifactKind | undefined {
    const text = String(userIntent || '').trim().toLowerCase();
    if (!text) return undefined;

    const directTarget = text.match(
        /(?:做成|改成|复刻成|还原成|复现成|临摹成|转换成|转成|设计|制作|生成|创作|产出|输出|交付|做|画)\s*(?:一张|一个|一版|一幅|个|张|版)?\s*(详情页|商品详情|产品详情|详情长图|商品长图|卖点页|海报|宣传图|活动图|banner|横幅|店铺头图|活动横幅|主图|首图|点击图|转化图|白底图|main[\s-]*image|hero[\s-]*image|detail[\s-]*page)/i
    );
    const directArtifact = artifactKindFromDeliverableText(directTarget?.[1]);
    if (directArtifact !== 'generic') return directArtifact;

    const replicationTarget = text.match(
        /(?:复刻|还原|复现|临摹)(?:一下)?\s*(?:这|这个|这张|该|一张|一个|一版|一幅)?\s*(详情页|商品详情|产品详情|详情长图|商品长图|卖点页|海报|宣传图|活动图|banner|横幅|店铺头图|活动横幅|主图|首图|点击图|转化图|白底图|main[\s-]*image|hero[\s-]*image|detail[\s-]*page)/i
    );
    const replicationArtifact = artifactKindFromDeliverableText(replicationTarget?.[1]);
    return replicationArtifact === 'generic' ? undefined : replicationArtifact;
}

export function inferReferenceReplicationArtifactKind(
    userIntent: unknown
): ReferenceReplicationArtifactKind {
    const text = String(userIntent || '').trim().toLowerCase();
    if (!text) return 'generic';

    const directArtifact = inferExplicitReferenceReplicationDeliverableKind(text);
    if (directArtifact) return directArtifact;

    if (!/参考|复刻|仿照|照着|还原|复现|同款|临摹/.test(text)) {
        return 'generic';
    }

    const mentionPattern = /详情页|商品详情|产品详情|详情长图|商品长图|卖点页|海报|宣传图|活动图|banner|横幅|店铺头图|活动横幅|主图|首图|点击图|转化图|白底图|main[\s-]*image|hero[\s-]*image|detail[\s-]*page/gi;
    const mentions = Array.from(text.matchAll(mentionPattern));
    const lastMention = mentions.length > 0 ? mentions[mentions.length - 1][0] : '';
    return artifactKindFromDeliverableText(lastMention);
}

function buildOutputIntentForArtifact(
    artifactKind: ReferenceReplicationArtifactKind
): ReferenceReplicationOutputIntent {
    if (artifactKind === 'detail-page') {
        return {
            version: 'reference-replication-output-intent/v1',
            artifactKind,
            artifactLabel: '详情页',
            topology: 'multi_screen',
            documentRole: 'detailPage',
            documentName: '详情页模板骨架',
            rootGroupPrefix: '详情页模板骨架',
            surfaceLabel: '详情页模块',
            surfaceUnit: '屏',
            canvasProfile: 'detail-template',
            fallbackCanvas: { width: 1242, height: 3600 },
            autoFillStrategy: 'detail-page'
        };
    }

    if (artifactKind === 'main-image') {
        return {
            version: 'reference-replication-output-intent/v1',
            artifactKind,
            artifactLabel: '主图',
            topology: 'single_canvas',
            documentRole: 'mainImage',
            documentName: '主图复刻骨架',
            rootGroupPrefix: '主图复刻骨架',
            surfaceLabel: '主图画面',
            surfaceUnit: '版面',
            canvasProfile: 'reference-replication',
            fallbackCanvas: { width: 1242, height: 1242 },
            autoFillStrategy: 'none'
        };
    }

    if (artifactKind === 'poster') {
        return {
            version: 'reference-replication-output-intent/v1',
            artifactKind,
            artifactLabel: '海报',
            topology: 'single_canvas',
            documentRole: 'poster',
            documentName: '海报复刻骨架',
            rootGroupPrefix: '海报复刻骨架',
            surfaceLabel: '海报画面',
            surfaceUnit: '版面',
            canvasProfile: 'reference-replication',
            fallbackCanvas: { width: 1080, height: 1440 },
            autoFillStrategy: 'none'
        };
    }

    if (artifactKind === 'banner') {
        return {
            version: 'reference-replication-output-intent/v1',
            artifactKind,
            artifactLabel: '横幅',
            topology: 'single_canvas',
            documentRole: 'banner',
            documentName: '横幅复刻骨架',
            rootGroupPrefix: '横幅复刻骨架',
            surfaceLabel: '横幅画面',
            surfaceUnit: '版面',
            canvasProfile: 'reference-replication',
            fallbackCanvas: { width: 1920, height: 640 },
            autoFillStrategy: 'none'
        };
    }

    return {
        version: 'reference-replication-output-intent/v1',
        artifactKind: 'generic',
        artifactLabel: '参考设计',
        topology: 'single_canvas',
        documentRole: 'unknown',
        documentName: '参考图复刻骨架',
        rootGroupPrefix: '参考图复刻骨架',
        surfaceLabel: '参考画面',
        surfaceUnit: '版面',
        canvasProfile: 'reference-replication',
        fallbackCanvas: { width: 1242, height: 1600 },
        autoFillStrategy: 'none'
    };
}

export function resolveReferenceReplicationOutputIntent(input: {
    artifactKind?: unknown;
    userIntent?: unknown;
}): ReferenceReplicationOutputIntent {
    const userDeclaredArtifact = inferExplicitReferenceReplicationDeliverableKind(input.userIntent);
    const explicitArtifact = parseReferenceReplicationArtifactKind(input.artifactKind);
    const artifactKind = userDeclaredArtifact
        || explicitArtifact
        || inferReferenceReplicationArtifactKind(input.userIntent);
    return buildOutputIntentForArtifact(artifactKind);
}

/**
 * 参考/复刻描述的是实现方法；Designer 场景必须跟随最终交付物。
 * 该映射集中在输出意图契约中，通用 Agent executor 不维护品类分支。
 */
export function resolveReferenceReplicationDeliveryScenario(
    outputIntent: ReferenceReplicationOutputIntent
): DesignAgentOsScenario {
    if (outputIntent.artifactKind === 'detail-page') return 'detail-page';
    if (outputIntent.artifactKind === 'main-image') return 'main-image';
    if (outputIntent.artifactKind === 'poster' || outputIntent.artifactKind === 'banner') {
        return 'general-design';
    }
    return 'reference-replication';
}

export function buildReferenceReplicationRootGroupName(
    outputIntent: ReferenceReplicationOutputIntent,
    dateStamp = new Date().toISOString().slice(0, 10)
): string {
    return `${outputIntent.rootGroupPrefix}_${dateStamp}`;
}

export function buildReferenceReplicationSurfaceGroupName(
    outputIntent: ReferenceReplicationOutputIntent,
    surface: {
        index: number;
        type: string;
    }
): string {
    if (outputIntent.topology === 'multi_screen') {
        return `一_${String(surface.index).padStart(2, '0')}_${surface.type}`;
    }
    return outputIntent.surfaceLabel;
}
