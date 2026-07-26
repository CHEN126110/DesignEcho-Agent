import { GripVertical, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../types';
import {
    addSkuComboToEditorValue,
    removeSkuComboFromEditorValue,
    moveSkuComboInEditorValue,
    stringifySkuCombo,
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboColorSlot,
    type SkuComboEditorValue
} from '../../../../shared/sku-combo-interactive-card';
import {
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../../../shared/editable-confirmation-interactive-card';
import {
    type VisualObservationBlockedCard,
    type StructureOnlySkeletonCard
} from '../../../../shared/agent-runtime-v5/visual-observation-card';
import {
    type PendingDestructiveActionCard
} from '../../../../shared/pending-destructive-action-card';
import {
    validateSkuHumanReviewCardValue,
    type SkuHumanReviewCard,
    type SkuHumanReviewCardValue
} from '../../../../shared/sku-human-review';
import {
    validateDesignProjectFactReviewCardValue,
    type DesignProjectFactReviewCard,
    type DesignProjectFactReviewCardValue
} from '../../../../shared/design-project-fact-review-card';
import {
    validateDesignProjectRuleReviewCardValue,
    type DesignProjectRuleReviewCard,
    type DesignProjectRuleReviewCardValue
} from '../../../../shared/design-project-rule-review-card';

interface InteractiveCardBlockProps {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

const SKU_COLOR_SLOT_DRAG_TYPE = 'application/x-designecho-sku-color-slot';
const SKU_COMBO_ROW_DRAG_TYPE = 'application/x-designecho-sku-combo-row';

function buildInitialSkuComboValue(card: SkuComboEditorCard): SkuComboEditorValue {
    return validateSkuComboEditorValue(card.payload, card.payload.initialValue).normalizedValue;
}

function hasSkuColorSlotDrag(event: React.DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types || []).includes(SKU_COLOR_SLOT_DRAG_TYPE);
}

function formatSkuSlotLabel(slot: number, colorSlot?: SkuComboColorSlot): string {
    return colorSlot ? `${slot} ${colorSlot.label}` : String(slot);
}

const SkuComboEditorCardView: React.FC<InteractiveCardBlockProps & { card: SkuComboEditorCard }> = ({
    block,
    card,
    onAction
}) => {
    const [editorValue, setEditorValue] = useState<SkuComboEditorValue>(() => buildInitialSkuComboValue(card));
    const [draft, setDraft] = useState<number[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [feedback, setFeedback] = useState('');
    // 组合行拖拽重排：记录正在拖的组合与当前悬停的目标行（仅同一双装组内重排）。
    const [draggingCombo, setDraggingCombo] = useState<{ size: number; index: number } | null>(null);
    const [dragOverCombo, setDragOverCombo] = useState<{ size: number; index: number } | null>(null);
    // 重复/新增时高亮并滚动到对应组合行（组合多、列表长，用户否则看不到发生了什么）。
    const [highlightedCombo, setHighlightedCombo] = useState<{ size: number; index: number } | null>(null);
    const highlightedRowRef = useRef<HTMLDivElement | null>(null);
    const colorSlots = useMemo(
        () => editorValue.colorSlots || card.payload.colorSlots,
        [card.payload.colorSlots, editorValue.colorSlots]
    );
    const colorSlotsById = useMemo(
        () => new Map(colorSlots.map((slot) => [slot.slot, slot])),
        [colorSlots]
    );
    const knownColorSlots = useMemo(
        () => new Set(colorSlots.map((slot) => slot.slot)),
        [colorSlots]
    );
    // 拖几个颜色就是几双装：规格集合升序去重，最大值作为一个组合的颜色上限。
    const requiredSizes = useMemo(
        () => Array.from(new Set(card.payload.requiredSizes)).sort((a, b) => a - b),
        [card.payload.requiredSizes]
    );
    const maxComboSize = requiredSizes.length > 0 ? requiredSizes[requiredSizes.length - 1] : 0;

    const validation = useMemo(
        () => validateSkuComboEditorValue(card.payload, editorValue),
        [card.payload, editorValue]
    );
    const draftSize = draft.length;
    const hasDraft = draftSize > 0;
    const draftSizeIsValid = requiredSizes.includes(draftSize);

    // 只把颜色加入当前草稿；不再需要预选规格，也不自动提交——由用户点「添加此组合」确认。
    function addColorToDraft(slot: number): void {
        setHighlightedCombo(null);
        if (!knownColorSlots.has(slot)) {
            setFeedback('这个颜色不属于当前 SKU 卡片，未添加。');
            return;
        }
        if (draft.length >= maxComboSize) {
            setFeedback(`一个组合最多 ${maxComboSize} 个颜色，已达上限。`);
            return;
        }
        const nextDraft = [...draft, slot];
        setDraft(nextDraft);
        setFeedback(requiredSizes.includes(nextDraft.length)
            ? `当前 ${nextDraft.length} 个颜色 = ${nextDraft.length}双装，可点「添加此组合」，或继续拖。`
            : `当前 ${nextDraft.length} 个颜色，再拖到 ${requiredSizes.join(' / ')} 个即可添加。`);
    }

    // 在某双装组内按「多重集」找与给定颜色集合相同的组合下标（与去重口径一致，忽略顺序）。
    function findComboIndexInGroup(size: number, colors: number[]): number {
        const group = editorValue.groups.find((item) => item.size === size);
        if (!group) return -1;
        const key = [...colors].sort((a, b) => a - b).join(',');
        return group.combos.findIndex((combo) => [...combo].sort((a, b) => a - b).join(',') === key);
    }

    // 按草稿里的颜色数量提交为对应双装的组合。
    function commitDraftCombo(): void {
        const size = draft.length;
        if (!requiredSizes.includes(size)) {
            setFeedback(`一个组合需要 ${requiredSizes.join(' / ')} 个颜色，当前 ${size} 个。`);
            return;
        }
        const mutation = addSkuComboToEditorValue(editorValue, size, draft);
        if (mutation.changed) {
            setEditorValue(mutation.value);
            // 高亮 + 滚动到刚加进去的那一组，避免列表长时用户看不到。
            const group = mutation.value.groups.find((item) => item.size === size);
            const newIndex = group ? group.combos.length - 1 : -1;
            if (newIndex >= 0) setHighlightedCombo({ size, index: newIndex });
            setFeedback(`已添加 ${size}双装组合 ${stringifySkuCombo(draft)}。`);
            setDraft([]);
            return;
        }
        if (mutation.reason === 'duplicate') {
            // 高亮 + 滚动到已存在的那一组，让用户看清"不是没反应，是重复了"。
            const matchIndex = findComboIndexInGroup(size, draft);
            if (matchIndex >= 0) setHighlightedCombo({ size, index: matchIndex });
            setFeedback(`组合 ${stringifySkuCombo(draft)} 已存在（已为你高亮那一组），未重复添加。`);
            return;
        }
        setFeedback('未能添加该组合，请重试。');
    }

    function removeCombo(size: number, comboIndex: number): void {
        const group = editorValue.groups.find((item) => item.size === size);
        const combo = group?.combos[comboIndex];
        const mutation = removeSkuComboFromEditorValue(editorValue, size, comboIndex);
        if (!mutation.changed) return;
        setHighlightedCombo(null);
        setEditorValue(mutation.value);
        setFeedback(`已删除 ${size}双装组合 ${combo ? stringifySkuCombo(combo) : ''}。`);
    }

    function handleComboDragStart(event: React.DragEvent<HTMLDivElement>, size: number, index: number): void {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(SKU_COMBO_ROW_DRAG_TYPE, `${size}:${index}`);
        setDraggingCombo({ size, index });
    }

    function handleComboDragEnter(size: number, index: number): void {
        if (draggingCombo && draggingCombo.size === size) {
            setDragOverCombo({ size, index });
        }
    }

    function handleComboDragOver(event: React.DragEvent<HTMLDivElement>, size: number): void {
        // 只允许在同一双装组内重排（不同双装颜色数量不同，不跨组移动）。
        if (!draggingCombo || draggingCombo.size !== size) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }

    function handleComboDragLeave(): void {
        setDragOverCombo(null);
    }

    function handleComboDrop(event: React.DragEvent<HTMLDivElement>, size: number, targetIndex: number): void {
        event.preventDefault();
        event.stopPropagation();
        const source = draggingCombo;
        setDraggingCombo(null);
        setDragOverCombo(null);
        if (!source || source.size !== size || source.index === targetIndex) return;
        const mutation = moveSkuComboInEditorValue(editorValue, size, source.index, targetIndex);
        if (!mutation.changed) return;
        setHighlightedCombo(null);
        setEditorValue(mutation.value);
        setFeedback(`已调整 ${size}双装组合顺序。`);
    }

    function handleComboDragEnd(): void {
        setDraggingCombo(null);
        setDragOverCombo(null);
    }

    // 高亮某组合后：滚动到它，并短暂停留后自动淡出高亮。
    useEffect(() => {
        if (!highlightedCombo || !highlightedRowRef.current) return;
        highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const timer = setTimeout(() => setHighlightedCombo(null), 2600);
        return () => clearTimeout(timer);
    }, [highlightedCombo]);

    function removeDraftSlot(slotIndex: number): void {
        setDraft((current) => current.filter((_, index) => index !== slotIndex));
        setFeedback('已从当前组合移除 1 个颜色。');
    }

    function clearDraft(): void {
        setDraft([]);
        setFeedback('已清空当前组合。');
    }

    function handleColorDragStart(event: React.DragEvent<HTMLButtonElement>, slot: number): void {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(SKU_COLOR_SLOT_DRAG_TYPE, String(slot));
    }

    function handleColorDragEnd(): void {
        setIsDragOver(false);
    }

    function handleDragOver(event: React.DragEvent<HTMLDivElement>): void {
        if (!hasSkuColorSlotDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
    }

    function handleDragLeave(event: React.DragEvent<HTMLDivElement>): void {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setIsDragOver(false);
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
        if (!hasSkuColorSlotDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        addColorToDraft(Number(event.dataTransfer.getData(SKU_COLOR_SLOT_DRAG_TYPE)));
    }

    function handleSubmit(): void {
        if (hasDraft) {
            setFeedback('还有没添加的组合，请先点「添加此组合」或清空后再确认。');
            return;
        }
        const latestValidation = validateSkuComboEditorValue(card.payload, editorValue);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitInteractiveCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    }

    return (
        <div className="message-block interactive-card-block sku-combo-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>

            <div className="sku-combo-builder-instructions">
                <span>把颜色拖进下面的组合框，或点击颜色添加；拖几个颜色就是几双装（{requiredSizes.join(' / ')}双），点「添加此组合」加入。</span>
            </div>

            <div className="sku-color-slot-list" role="list" aria-label="可用颜色">
                {colorSlots.map((slot) => (
                    <div
                        className="sku-color-slot-item"
                        key={slot.slot}
                        role="listitem"
                    >
                        <button
                            type="button"
                            className="sku-color-slot"
                            draggable
                            aria-label={`颜色 ${formatSkuSlotLabel(slot.slot, slot)}，拖动或点击加入当前组合`}
                            title="拖到组合框，或点击加入当前组合"
                            onClick={() => addColorToDraft(slot.slot)}
                            onDragStart={(event) => handleColorDragStart(event, slot.slot)}
                            onDragEnd={handleColorDragEnd}
                        >
                            <GripVertical size={13} aria-hidden="true" />
                            {slot.colorHex && (
                                <span className="sku-color-slot-swatch" style={{ backgroundColor: slot.colorHex }} aria-hidden="true" />
                            )}
                            <span className="sku-color-slot-number">{slot.slot}</span>
                            <span className="sku-color-slot-label">{slot.label}</span>
                        </button>
                    </div>
                ))}
            </div>

            <section className={`sku-combo-composer${isDragOver ? ' is-drag-over' : ''}`}>
                <div className="sku-combo-field-header">
                    <span className="sku-combo-label">
                        当前组合{draftSizeIsValid ? ` = ${draftSize}双装` : ''}
                    </span>
                    <span className="sku-combo-draft-count">{draftSize} 个颜色</span>
                </div>
                <div
                    className="sku-combo-drop-zone"
                    role="group"
                    tabIndex={0}
                    aria-label={`组合添加区，当前 ${draftSize} 个颜色；拖几个颜色就是几双装`}
                    onDragEnter={handleDragOver}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="sku-combo-draft-content">
                        {draft.length === 0 ? (
                            <span className="sku-combo-drop-hint">拖入或点击颜色（{requiredSizes.join(' / ')} 个 = 对应双装）</span>
                        ) : draft.map((slot, slotIndex) => (
                            <span className="sku-combo-token is-draft" key={`${slot}-${slotIndex}`}>
                                <span>{formatSkuSlotLabel(slot, colorSlotsById.get(slot))}</span>
                                <button
                                    type="button"
                                    aria-label={`从当前组合移除 ${formatSkuSlotLabel(slot, colorSlotsById.get(slot))}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeDraftSlot(slotIndex);
                                    }}
                                >
                                    <X size={12} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
                <div className="sku-combo-composer-actions">
                    <button
                        type="button"
                        className="sku-combo-commit-draft"
                        disabled={!draftSizeIsValid}
                        onClick={commitDraftCombo}
                    >
                        {draftSizeIsValid ? `添加 ${draftSize}双装组合` : '添加此组合'}
                    </button>
                    {draft.length > 0 && (
                        <button type="button" className="sku-combo-clear-draft" onClick={clearDraft}>
                            清空
                        </button>
                    )}
                </div>
            </section>

            {feedback && <div className="sku-combo-feedback sku-combo-feedback-inline" role="status" aria-live="polite">{feedback}</div>}

            <div className="sku-combo-editor-grid">
                {requiredSizes.map((size) => {
                    const group = editorValue.groups.find((item) => item.size === size) || { size, combos: [] };
                    return (
                        <section
                            className="sku-combo-field"
                            key={size}
                        >
                            <div className="sku-combo-field-header">
                                <span className="sku-combo-label">{size}双装组合</span>
                                <span className="sku-combo-count">{group.combos.length} 组</span>
                            </div>
                            <div className="sku-combo-list" aria-label={`${size}双装已有组合`}>
                                {group.combos.length === 0 ? (
                                    <div className="sku-combo-empty">还没有组合</div>
                                ) : group.combos.map((combo, comboIndex) => {
                                    const isDropTarget = dragOverCombo?.size === size && dragOverCombo?.index === comboIndex;
                                    const isDragging = draggingCombo?.size === size && draggingCombo?.index === comboIndex;
                                    const isHighlighted = highlightedCombo?.size === size && highlightedCombo?.index === comboIndex;
                                    return (
                                        <div
                                            className={`sku-combo-row${isDropTarget ? ' is-drop-target' : ''}${isDragging ? ' is-dragging' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                                            key={`${stringifySkuCombo(combo)}-${comboIndex}`}
                                            ref={isHighlighted ? highlightedRowRef : undefined}
                                            draggable
                                            onDragStart={(event) => handleComboDragStart(event, size, comboIndex)}
                                            onDragEnter={() => handleComboDragEnter(size, comboIndex)}
                                            onDragOver={(event) => handleComboDragOver(event, size)}
                                            onDragLeave={handleComboDragLeave}
                                            onDrop={(event) => handleComboDrop(event, size, comboIndex)}
                                            onDragEnd={handleComboDragEnd}
                                        >
                                            <span className="sku-combo-row-grip" aria-hidden="true" title="拖动调整顺序">
                                                <GripVertical size={12} />
                                            </span>
                                            <div className="sku-combo-row-values" aria-label={`组合 ${stringifySkuCombo(combo)}`}>
                                                {combo.map((slot, slotIndex) => (
                                                    <React.Fragment key={`${slot}-${slotIndex}`}>
                                                        {slotIndex > 0 && <span className="sku-combo-plus" aria-hidden="true">+</span>}
                                                        <span className="sku-combo-token">
                                                            {formatSkuSlotLabel(slot, colorSlotsById.get(slot))}
                                                        </span>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                className="sku-combo-remove"
                                                aria-label={`删除 ${size}双装组合 ${stringifySkuCombo(combo)}`}
                                                onClick={() => removeCombo(size, comboIndex)}
                                            >
                                                <X size={14} aria-hidden="true" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>

            <label className="sku-combo-note-toggle">
                <input
                    type="checkbox"
                    checked={editorValue.generateSelfSelectNotes !== false}
                    onChange={(event) => setEditorValue((current) => ({
                        ...current,
                        generateSelfSelectNotes: event.target.checked
                    }))}
                />
                <span>生成自选备注</span>
            </label>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div
                            key={`${issue.code}-${index}`}
                            className={`interactive-card-issue ${issue.severity}`}
                        >
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button
                    type="button"
                    className="interactive-card-submit"
                    disabled={!validation.canSubmit || hasDraft}
                    onClick={handleSubmit}
                >
                    确认组合
                </button>
            </div>
        </div>
    );
};

function buildEditableInitialValue(card: EditableConfirmationCard): EditableConfirmationValue {
    return card.payload.initialValue || {
        values: Object.fromEntries(card.payload.fields.map((field) => [
            field.id,
            field.type === 'boolean' ? Boolean(field.value) : String(field.value || '')
        ]))
    };
}

const EditableConfirmationCardView: React.FC<InteractiveCardBlockProps & { card: EditableConfirmationCard }> = ({
    block,
    card,
    onAction
}) => {
    const [values, setValues] = useState<Record<string, string | boolean>>(() => buildEditableInitialValue(card).values || {});
    const value = useMemo<EditableConfirmationValue>(() => ({ values }), [values]);
    const validation = useMemo(
        () => validateEditableConfirmationValue(card.payload, value),
        [card.payload, value]
    );

    const updateValue = (fieldId: string, nextValue: string | boolean) => {
        setValues((current) => ({
            ...current,
            [fieldId]: nextValue
        }));
    };

    const handleSubmit = () => {
        const latestValue = { values };
        const latestValidation = validateEditableConfirmationValue(card.payload, latestValue);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitInteractiveCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>

            <div className="editable-card-fields">
                {card.payload.fields.map((field) => {
                    const current = values[field.id];
                    const fieldLabel = `${field.label}${field.required ? ' *' : ''}`;
                    if (field.type === 'boolean') {
                        return (
                            <label className="editable-card-toggle" key={field.id}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(current)}
                                    onChange={(event) => updateValue(field.id, event.target.checked)}
                                />
                                <span>{fieldLabel}</span>
                            </label>
                        );
                    }
                    if (field.type === 'choice') {
                        return (
                            <label className="editable-card-field" key={field.id}>
                                <span className="editable-card-label">{fieldLabel}</span>
                                <select
                                    value={String(current || '')}
                                    onChange={(event) => updateValue(field.id, event.target.value)}
                                >
                                    {(field.options || []).map((option) => (
                                        <option value={option.value} key={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                {field.description && <span className="editable-card-help">{field.description}</span>}
                            </label>
                        );
                    }
                    if (field.type === 'long_text') {
                        return (
                            <label className="editable-card-field" key={field.id}>
                                <span className="editable-card-label">{fieldLabel}</span>
                                <textarea
                                    value={String(current || '')}
                                    onChange={(event) => updateValue(field.id, event.target.value)}
                                    rows={Math.max(3, String(current || '').split(/\n/).length)}
                                    spellCheck={false}
                                />
                                {field.description && <span className="editable-card-help">{field.description}</span>}
                            </label>
                        );
                    }
                    return (
                        <label className="editable-card-field" key={field.id}>
                            <span className="editable-card-label">{fieldLabel}</span>
                            <input
                                type="text"
                                value={String(current || '')}
                                onChange={(event) => updateValue(field.id, event.target.value)}
                            />
                            {field.description && <span className="editable-card-help">{field.description}</span>}
                        </label>
                    );
                })}
            </div>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div
                            key={`${issue.code}-${index}`}
                            className={`interactive-card-issue ${issue.severity}`}
                        >
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button
                    type="button"
                    className="interactive-card-submit"
                    disabled={!validation.canSubmit}
                    onClick={handleSubmit}
                >
                    确认
                </button>
            </div>
        </div>
    );
};

const SkuHumanReviewCardView: React.FC<InteractiveCardBlockProps & { card: SkuHumanReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decision, setDecision] = useState<SkuHumanReviewCardValue['decision']>(card.payload.initialValue.decision);
    const [reviewer, setReviewer] = useState(card.payload.initialValue.reviewer);
    const [scoreText, setScoreText] = useState(card.payload.initialValue.score === undefined
        ? ''
        : String(card.payload.initialValue.score));
    const [notesText, setNotesText] = useState(card.payload.initialValue.notes.join('\n'));
    const value = useMemo(() => ({
        decision,
        reviewer,
        score: scoreText,
        notes: notesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    }), [decision, reviewer, scoreText, notesText]);
    const validation = useMemo(
        () => validateSkuHumanReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateSkuHumanReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitSkuHumanReviewCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card sku-human-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待人工复核</span>
            </div>

            {card.payload.requirements.length > 0 && (
                <ul className="interactive-card-review-requirements">
                    {card.payload.requirements.slice(0, 6).map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                    ))}
                </ul>
            )}

            <div className="editable-card-fields">
                <label className="editable-card-field">
                    <span className="editable-card-label">复核结论 *</span>
                    <select value={decision} onChange={(event) => setDecision(event.target.value as SkuHumanReviewCardValue['decision'])}>
                        <option value="needs_review">需要调整</option>
                        <option value="approved">通过</option>
                        <option value="rejected">驳回</option>
                    </select>
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">复核人</span>
                    <input type="text" value={reviewer} onChange={(event) => setReviewer(event.target.value)} />
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">人工评分（0 到 1）</span>
                    <input type="number" min="0" max="1" step="0.01" value={scoreText} onChange={(event) => setScoreText(event.target.value)} />
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">复核备注</span>
                    <textarea value={notesText} onChange={(event) => setNotesText(event.target.value)} rows={3} />
                </label>
            </div>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`interactive-card-issue ${issue.severity}`}>
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button type="button" className="interactive-card-submit" disabled={!validation.canSubmit} onClick={handleSubmit}>
                    写入本批次复核记录
                </button>
            </div>
        </div>
    );
};

const DesignProjectFactReviewCardView: React.FC<InteractiveCardBlockProps & { card: DesignProjectFactReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decisions, setDecisions] = useState<Record<string, DesignProjectFactReviewCardValue['decisions'][number]['decision']>>(
        () => Object.fromEntries(card.payload.facts.map((fact) => [fact.factId, 'needs_review']))
    );
    const value = useMemo<DesignProjectFactReviewCardValue>(() => ({
        decisions: card.payload.facts.map((fact) => ({
            factId: fact.factId,
            decision: decisions[fact.factId] || 'needs_review'
        }))
    }), [card.payload.facts, decisions]);
    const validation = useMemo(
        () => validateDesignProjectFactReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateDesignProjectFactReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitDesignProjectFactReviewCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card design-project-fact-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待事实确认</span>
            </div>

            <div className="editable-card-fields">
                {card.payload.facts.map((fact) => (
                    <label className="editable-card-field" key={fact.factId}>
                        <span className="editable-card-label">
                            {fact.claimType === 'product_fact' ? '产品事实' : '卖点'}：{fact.statement}
                        </span>
                        <span className="editable-card-help">来源：{fact.sourceKinds.map(formatFactSourceKind).join('、')}</span>
                        <select
                            value={decisions[fact.factId] || 'needs_review'}
                            onChange={(event) => setDecisions((current) => ({
                                ...current,
                                [fact.factId]: event.target.value as DesignProjectFactReviewCardValue['decisions'][number]['decision']
                            }))}
                        >
                            <option value="needs_review">暂不确认</option>
                            <option value="confirm">确认属实</option>
                            <option value="reject">驳回</option>
                        </select>
                    </label>
                ))}
            </div>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`interactive-card-issue ${issue.severity}`}>
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button type="button" className="interactive-card-submit" disabled={!validation.canSubmit} onClick={handleSubmit}>
                    写入事实复核结论
                </button>
            </div>
        </div>
    );
};

const DesignProjectRuleReviewCardView: React.FC<InteractiveCardBlockProps & { card: DesignProjectRuleReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decisions, setDecisions] = useState<Record<string, DesignProjectRuleReviewCardValue['decisions'][number]['decision']>>(
        () => Object.fromEntries(card.payload.rules.map((rule) => [rule.ruleId, 'needs_review']))
    );
    const value = useMemo<DesignProjectRuleReviewCardValue>(() => ({
        decisions: card.payload.rules.map((rule) => ({
            ruleId: rule.ruleId,
            decision: decisions[rule.ruleId] || 'needs_review'
        }))
    }), [card.payload.rules, decisions]);
    const validation = useMemo(
        () => validateDesignProjectRuleReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateDesignProjectRuleReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitDesignProjectRuleReviewCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card design-project-rule-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待规则确认</span>
            </div>
            <div className="editable-card-fields">
                {card.payload.rules.map((rule) => (
                    <label className="editable-card-field" key={rule.ruleId}>
                        <span className="editable-card-label">{formatRuleKind(rule.ruleKind)}：{rule.statement}</span>
                        <span className="editable-card-help">
                            强制等级：{formatRuleEnforcement(rule.enforcement)}；来源：{rule.sourceKinds.map(formatRuleSourceKind).join('、')}
                        </span>
                        <select
                            value={decisions[rule.ruleId] || 'needs_review'}
                            onChange={(event) => setDecisions((current) => ({
                                ...current,
                                [rule.ruleId]: event.target.value as DesignProjectRuleReviewCardValue['decisions'][number]['decision']
                            }))}
                        >
                            <option value="needs_review">暂不确认</option>
                            <option value="confirm">确认规则</option>
                            <option value="reject">驳回规则</option>
                        </select>
                    </label>
                ))}
            </div>
            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`interactive-card-issue ${issue.severity}`}>{issue.message}</div>
                    ))}
                </div>
            )}
            <div className="interactive-card-actions">
                <button type="button" className="interactive-card-submit" disabled={!validation.canSubmit} onClick={handleSubmit}>
                    写入规则复核结论
                </button>
            </div>
        </div>
    );
};

function formatFactSourceKind(value: string): string {
    if (value === 'user_statement') return '用户陈述';
    if (value === 'project_asset_observation') return '项目素材观察';
    if (value === 'product_document') return '产品文档';
    if (value === 'brand_guideline') return '品牌规范';
    if (value === 'market_research') return '市场研究';
    if (value === 'agent_inference') return 'Agent 推断';
    return '旧状态（来源不明）';
}

function formatRuleKind(value: string): string {
    const labels: Record<string, string> = {
        visual_style: '视觉风格', color: '色彩', typography: '排版', copy_tone: '文案语气',
        asset_integrity: '素材真实性', forbidden_expression: '禁用表达', delivery: '交付', workflow: '工作方式'
    };
    return labels[value] || value;
}

function formatRuleEnforcement(value: string): string {
    if (value === 'quality_gate') return '质量门禁';
    if (value === 'approval_required') return '交付前审批';
    return '设计参考';
}

function formatRuleSourceKind(value: string): string {
    const labels: Record<string, string> = {
        user_statement: '用户陈述', brand_guideline: '品牌规范', project_brief: '项目简报',
        design_memory: '设计记忆', agent_inference: 'Agent 推断', legacy_brand_style: '旧品牌风格'
    };
    return labels[value] || value;
}

const VisualObservationBlockedCardView: React.FC<InteractiveCardBlockProps & { card: VisualObservationBlockedCard }> = ({
    card,
    onAction
}) => {
    return (
        <div className="message-block interactive-card-block visual-observation-blocked-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
            </div>
            <div className="interactive-card-actions visual-observation-card-actions">
                {card.actions.map((action) => {
                    const disabled = action.state === 'disabled';
                    return (
                        <button
                            key={action.actionId}
                            type="button"
                            className="interactive-card-action-button"
                            disabled={disabled}
                            title={disabled ? action.disabledReason?.message : undefined}
                            onClick={() => {
                                if (disabled) return;
                                onAction?.(card.submitAction || 'submitInteractiveCard', {
                                    cardId: card.id,
                                    cardKind: card.kind,
                                    card,
                                    value: { actionId: action.actionId }
                                });
                            }}
                        >
                            {action.label}{disabled ? '（即将可用）' : ''}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const StructureOnlySkeletonCardView: React.FC<InteractiveCardBlockProps & { card: StructureOnlySkeletonCard }> = ({
    card
}) => {
    return (
        <div className="message-block interactive-card-block structure-only-skeleton-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">结构草案</span>
            </div>
            <ol className="structure-skeleton-module-list">
                {card.payload.modules.map((moduleView) => (
                    <li className="structure-skeleton-module" key={moduleView.moduleId}>
                        <div className="structure-skeleton-module-intent">{moduleView.intentText}</div>
                        <div className="structure-skeleton-module-meta">
                            {moduleView.placeholders.length > 0 && (
                                <span className="structure-skeleton-placeholders">占位：{moduleView.placeholders.join(' ')}</span>
                            )}
                            {moduleView.requiredInputSlots.length > 0 && (
                                <span className="structure-skeleton-input">所需内容：{moduleView.requiredInputSlots.join('、')}</span>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
        </div>
    );
};

const PendingDestructiveActionCardView: React.FC<InteractiveCardBlockProps & { card: PendingDestructiveActionCard }> = ({
    card,
    onAction
}) => {
    return (
        <div className="message-block interactive-card-block destructive-action-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>
            <div className="interactive-card-actions destructive-action-card-actions">
                {card.actions.map((action) => (
                    <button
                        key={action.actionId}
                        type="button"
                        className={`interactive-card-action-button ${action.intent === 'confirm' ? 'is-destructive-confirm' : 'is-cancel'}`}
                        onClick={() => onAction?.(card.submitAction || 'submitDestructiveActionCard', {
                            cardId: card.id,
                            cardKind: card.kind,
                            card,
                            value: { actionId: action.actionId }
                        })}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

export const InteractiveCardBlock: React.FC<InteractiveCardBlockProps> = ({ block, onAction }) => {
    const card = block.card;
    if (block.submission) {
        const execution = block.submission.execution;
        let description = '确认内容已提交。';
        let statusLabel = '已提交';
        if (execution?.status === 'succeeded') {
            description = execution.message || '确认内容已执行完成。';
            statusLabel = '已完成';
        } else if (execution?.status === 'failed') {
            description = execution.message || '操作在 Photoshop 写入前校验失败，未开始写入；可以重新发起任务。';
            statusLabel = '执行失败';
        } else if (execution?.status === 'unknown') {
            description = execution.message || '执行状态不确定，请先检查 Photoshop；系统不会自动重放。';
            statusLabel = '待复核';
        }
        return (
            <div className="message-block interactive-card-block is-submitted">
                <div className="interactive-card-header">
                    <div>
                        <div className="interactive-card-title">{card.title}</div>
                        <div className="interactive-card-description">{description}</div>
                    </div>
                    <span className="interactive-card-status">{statusLabel}</span>
                </div>
            </div>
        );
    }
    const handleAction = (actionId: string, params?: Record<string, any>): void => {
        onAction?.(actionId, {
            ...(params || {}),
            sourceMessageId: block.sourceMessageId
        });
    };
    if (card.kind === 'sku_combo_editor' && (card.payload as any)?.version === 'sku-combo-editor/v0') {
        return <SkuComboEditorCardView block={block} card={card as SkuComboEditorCard} onAction={handleAction} />;
    }
    if (card.kind === 'editable_confirmation' && (card.payload as any)?.version === 'editable-confirmation/v0') {
        return <EditableConfirmationCardView block={block} card={card as EditableConfirmationCard} onAction={handleAction} />;
    }
    if (card.kind === 'sku_human_review' && (card.payload as any)?.version === 'sku-human-review-card/v0') {
        return <SkuHumanReviewCardView block={block} card={card as SkuHumanReviewCard} onAction={handleAction} />;
    }
    if (card.kind === 'design_project_fact_review' && (card.payload as any)?.version === 'design-project-fact-review-card/v0') {
        return <DesignProjectFactReviewCardView block={block} card={card as DesignProjectFactReviewCard} onAction={handleAction} />;
    }
    if (card.kind === 'design_project_rule_review' && (card.payload as any)?.version === 'design-project-rule-review-card/v0') {
        return <DesignProjectRuleReviewCardView block={block} card={card as DesignProjectRuleReviewCard} onAction={handleAction} />;
    }
    if (card.kind === 'visual-observation.blocked') {
        return <VisualObservationBlockedCardView block={block} card={card as unknown as VisualObservationBlockedCard} onAction={handleAction} />;
    }
    if (card.kind === 'structure-only.skeleton') {
        return <StructureOnlySkeletonCardView block={block} card={card as unknown as StructureOnlySkeletonCard} onAction={handleAction} />;
    }
    if (card.kind === 'destructive-action.confirmation') {
        return <PendingDestructiveActionCardView block={block} card={card as unknown as PendingDestructiveActionCard} onAction={handleAction} />;
    }

    return (
        <div className="message-block interactive-card-block">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
            </div>
            <div className="interactive-card-actions">
                <button
                    type="button"
                    className="interactive-card-submit"
                    onClick={() => handleAction(card.submitAction || 'submitInteractiveCard', {
                        cardId: card.id,
                        cardKind: card.kind,
                        card,
                        value: {}
                    })}
                >
                    确认
                </button>
            </div>
        </div>
    );
};

export default InteractiveCardBlock;
