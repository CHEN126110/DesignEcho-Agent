import type {
    DesignMemoryItem,
    DesignMemoryKind,
    DesignMemoryScope
} from './design-memory-knowledge';
import {
    buildInteractiveCardValidationResult,
    cleanInteractiveCardText,
    stableInteractiveCardHash,
    type InteractiveCardDefinition,
    type InteractiveCardValidationIssue,
    type InteractiveCardValidationResult
} from './interactive-card-contract';

export type EditableConfirmationFieldType =
    | 'short_text'
    | 'long_text'
    | 'choice'
    | 'boolean';

export interface EditableConfirmationFieldOption {
    value: string;
    label: string;
}

export interface EditableConfirmationField {
    id: string;
    label: string;
    type: EditableConfirmationFieldType;
    description?: string;
    required?: boolean;
    value?: string | boolean;
    options?: EditableConfirmationFieldOption[];
    maxLength?: number;
}

export interface EditableConfirmationValue {
    values: Record<string, string | boolean>;
}

export interface EditableConfirmationPayload {
    version: 'editable-confirmation/v0';
    fields: EditableConfirmationField[];
    initialValue: EditableConfirmationValue;
    memory?: {
        kind?: DesignMemoryKind;
        tags?: string[];
        title?: string;
    };
    productHints?: {
        projectId?: string;
        productType?: string;
        style?: string;
    };
}

export type EditableConfirmationCard = InteractiveCardDefinition<EditableConfirmationPayload>;

export interface BuildEditableConfirmationInteractiveCardInput {
    id?: string;
    title?: string;
    description?: string;
    fields: EditableConfirmationField[];
    initialValue?: EditableConfirmationValue;
    projectId?: string;
    productType?: string;
    style?: string;
    memoryEnabled?: boolean;
    memoryKind?: DesignMemoryKind;
    tags?: string[];
}

export interface BuildEditableConfirmationApprovedMemoryInput {
    card: EditableConfirmationCard;
    value: EditableConfirmationValue;
    scope?: DesignMemoryScope;
    confirmedBy?: string;
    confirmedAt?: string | number | Date;
}

const FIELD_TYPES = new Set<EditableConfirmationFieldType>([
    'short_text',
    'long_text',
    'choice',
    'boolean'
]);

function normalizeFieldType(value: unknown): EditableConfirmationFieldType {
    return FIELD_TYPES.has(value as EditableConfirmationFieldType)
        ? value as EditableConfirmationFieldType
        : 'short_text';
}

function normalizeFieldId(value: unknown): string {
    return cleanInteractiveCardText(value)
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
}

function normalizeOptions(value: unknown): EditableConfirmationFieldOption[] {
    const raw = Array.isArray(value) ? value : [];
    const options = raw
        .map((item): EditableConfirmationFieldOption | null => {
            const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const optionValue = cleanInteractiveCardText(record.value);
            const label = cleanInteractiveCardText(record.label || record.value);
            if (!optionValue || !label) return null;
            return { value: optionValue, label };
        })
        .filter((item): item is EditableConfirmationFieldOption => Boolean(item));
    const seen = new Set<string>();
    return options.filter((option) => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
    }).slice(0, 12);
}

function normalizeBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    const text = cleanInteractiveCardText(value).toLowerCase();
    if (!text) return false;
    if (['false', '0', 'no', 'off', '否', '不', '关闭'].includes(text)) return false;
    return true;
}

function normalizeFields(value: unknown): EditableConfirmationField[] {
    const raw = Array.isArray(value) ? value : [];
    const fields = raw
        .map((item): EditableConfirmationField | null => {
            const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const id = normalizeFieldId(record.id);
            const label = cleanInteractiveCardText(record.label || id);
            if (!id || !label) return null;
            let type = normalizeFieldType(record.type);
            let options = type === 'choice' ? normalizeOptions(record.options) : undefined;
            // fields 是模型在 createInteractiveCard 工具调用里现场生成的自由文本，没有工具层
            // schema 强制"choice 必须有非空 options"。空下拉框对用户毫无意义，这里退化为文本框，
            // 比原样展示一个不可选的空 select 更诚实可用。
            if (type === 'choice' && (!options || options.length === 0)) {
                console.warn(`[EditableConfirmationCard] 字段 "${id}" 声明为 choice 但 options 为空，已退化为 short_text。`);
                type = 'short_text';
                options = undefined;
            }
            const normalizedRawValue = type === 'boolean'
                ? normalizeBoolean(record.value)
                : cleanInteractiveCardText(record.value);
            // choice 字段若模型给出的默认 value 不在 options 里（同样是模型生成阶段的疏漏，
            // 不是用户输入），回退到第一个可选项，避免卡片在用户还没交互前就自相矛盾地报
            // "不是可选项"——校验错误应该反映用户自己的选择，不该来自卡片构建阶段的缺陷。
            let finalValue: string | boolean = normalizedRawValue;
            if (type === 'choice' && options && options.length > 0) {
                const hasMatchingOption = options.some((option) => option.value === normalizedRawValue);
                if (!hasMatchingOption) {
                    console.warn(`[EditableConfirmationCard] 字段 "${id}" 的默认值 "${String(normalizedRawValue)}" 不在 options 里，已回退到第一个可选项。`);
                    finalValue = options[0].value;
                }
            }
            return {
                id,
                label,
                type,
                description: cleanInteractiveCardText(record.description) || undefined,
                required: record.required === true,
                value: finalValue,
                options,
                maxLength: Math.max(0, Math.min(2000, Math.floor(Number(record.maxLength) || 0))) || undefined
            };
        })
        .filter((item): item is EditableConfirmationField => Boolean(item));
    const seen = new Set<string>();
    return fields.filter((field) => {
        if (seen.has(field.id)) return false;
        seen.add(field.id);
        return true;
    }).slice(0, 12);
}

function normalizeValueForField(field: EditableConfirmationField, rawValue: unknown): string | boolean {
    if (field.type === 'boolean') return normalizeBoolean(rawValue);
    const maxLength = field.maxLength || (field.type === 'long_text' ? 1200 : 240);
    return cleanInteractiveCardText(rawValue).slice(0, maxLength);
}

function normalizeEditableConfirmationValue(
    fields: EditableConfirmationField[],
    value: unknown
): EditableConfirmationValue {
    const record = value && typeof value === 'object' ? value as Record<string, any> : {};
    const values = record.values && typeof record.values === 'object' ? record.values : record;
    const normalized: EditableConfirmationValue = { values: {} };
    for (const field of fields) {
        const rawValue = values[field.id] ?? field.value ?? '';
        normalized.values[field.id] = normalizeValueForField(field, rawValue);
    }
    return normalized;
}

function buildDefaultValue(fields: EditableConfirmationField[]): EditableConfirmationValue {
    return normalizeEditableConfirmationValue(fields, {});
}

export function validateEditableConfirmationValue(
    payload: EditableConfirmationPayload,
    value: unknown
): InteractiveCardValidationResult<EditableConfirmationValue> {
    const fields = normalizeFields(payload.fields);
    const normalizedValue = normalizeEditableConfirmationValue(fields, value);
    const issues: InteractiveCardValidationIssue[] = [];

    if (fields.length === 0) {
        issues.push({
            severity: 'error',
            code: 'missing_fields',
            message: '这张确认卡片没有可编辑内容，不能提交。'
        });
    }

    for (const field of fields) {
        const currentValue = normalizedValue.values[field.id];
        if (field.required && field.type !== 'boolean' && !cleanInteractiveCardText(currentValue)) {
            issues.push({
                severity: 'error',
                code: 'required_field_empty',
                message: `${field.label}不能为空。`,
                path: `values.${field.id}`
            });
        }
        if (field.type === 'choice') {
            const optionValues = new Set((field.options || []).map((option) => option.value));
            if (optionValues.size > 0 && !optionValues.has(String(currentValue || ''))) {
                issues.push({
                    severity: 'error',
                    code: 'choice_value_not_allowed',
                    message: `${field.label}不是可选项。`,
                    path: `values.${field.id}`
                });
            }
        }
    }

    return buildInteractiveCardValidationResult({
        normalizedValue,
        issues
    });
}

export function buildEditableConfirmationInteractiveCard(
    input: BuildEditableConfirmationInteractiveCardInput
): EditableConfirmationCard {
    const fields = normalizeFields(input.fields);
    const initialValue = input.initialValue
        ? normalizeEditableConfirmationValue(fields, input.initialValue)
        : buildDefaultValue(fields);
    const projectId = cleanInteractiveCardText(input.projectId);
    const tags = (Array.isArray(input.tags) ? input.tags : [])
        .map(cleanInteractiveCardText)
        .filter(Boolean)
        .slice(0, 12);
    const title = cleanInteractiveCardText(input.title) || '请确认';
    const payload: EditableConfirmationPayload = {
        version: 'editable-confirmation/v0',
        fields,
        initialValue,
        memory: {
            kind: input.memoryKind || 'project_rule',
            tags,
            title
        },
        productHints: {
            ...(projectId ? { projectId } : {}),
            ...(cleanInteractiveCardText(input.productType) ? { productType: cleanInteractiveCardText(input.productType) } : {}),
            ...(cleanInteractiveCardText(input.style) ? { style: cleanInteractiveCardText(input.style) } : {})
        }
    };
    const id = cleanInteractiveCardText(input.id)
        || `editable-confirmation-${stableInteractiveCardHash({ title, fields, projectId })}`;

    return {
        version: 'interactive-card/v0',
        id,
        kind: 'editable_confirmation',
        title,
        description: cleanInteractiveCardText(input.description) || '确认或修改后继续。',
        payload,
        status: 'draft',
        submitAction: 'submitInteractiveCard',
        memoryPolicy: {
            enabled: input.memoryEnabled === true,
            mode: input.memoryEnabled === true ? 'approved_content' : 'none',
            scope: projectId ? { type: 'project', id: projectId } : { type: 'user' },
            reviewRequired: false
        }
    };
}

function normalizeConfirmedAt(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const text = cleanInteractiveCardText(value);
    const parsed = text ? Date.parse(text) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function formatEditableSummary(card: EditableConfirmationCard, value: EditableConfirmationValue): string {
    return card.payload.fields
        .map((field) => {
            const raw = value.values[field.id];
            const rendered = typeof raw === 'boolean' ? (raw ? '是' : '否') : cleanInteractiveCardText(raw);
            return rendered ? `${field.label}：${rendered}` : '';
        })
        .filter(Boolean)
        .join('；');
}

export function buildEditableConfirmationApprovedMemory(
    input: BuildEditableConfirmationApprovedMemoryInput
): DesignMemoryItem {
    const validation = validateEditableConfirmationValue(input.card.payload, input.value);
    const value = validation.normalizedValue;
    const scope = input.scope || input.card.memoryPolicy?.scope || { type: 'user' as const };
    const confirmedAt = normalizeConfirmedAt(input.confirmedAt);
    const tags = Array.from(new Set([
        'interactive-card',
        'approved-content',
        ...(input.card.payload.memory?.tags || [])
    ].map(cleanInteractiveCardText).filter(Boolean)));
    const summary = formatEditableSummary(input.card, value);
    const id = `editable-confirmation-${stableInteractiveCardHash({
        scope,
        cardId: input.card.id,
        values: value.values
    })}`;

    return {
        id,
        kind: input.card.payload.memory?.kind || 'project_rule',
        scope,
        status: 'active',
        source: 'accepted_output',
        title: input.card.payload.memory?.title || input.card.title,
        summary,
        sourceNotes: [{
            source: 'interactive-card-confirmation',
            summary: [
                `card=${input.card.id}`,
                `confirmed_by=${cleanInteractiveCardText(input.confirmedBy) || 'user'}`,
                `confirmed_at=${confirmedAt}`
            ].join('; '),
            status: 'active'
        }],
        tags: Array.from(new Set([
            ...tags,
            ...((input.card.payload.memory?.kind || 'project_rule') === 'project_rule' ? ['non-executable-rule-source'] : [])
        ])),
        appliesTo: ['rule'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceRank: 80,
        createdAt: confirmedAt,
        updatedAt: confirmedAt
    };
}
