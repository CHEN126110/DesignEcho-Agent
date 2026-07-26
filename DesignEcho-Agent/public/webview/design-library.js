var templateLibraryState = {
    success: false,
    detailReady: false,
    connected: false,
    error: '',
    settings: { localLibraryDirs: [], libraries: [] },
    libraries: [],
    activeLibraryId: '',
    relativePath: '',
    breadcrumbs: [],
    entries: [],
    assets: [],
    tags: [],
    templates: [],
    storageInfo: null
};
var templateLibraryView = 'list';
var templateLibraryQuery = '';
var templateLibraryAssetQuery = '';
var templateLibraryCardSize = 52;
var templateLibraryCreateModalVisible = false;
var templateLibraryDraftName = '';
var templateLibraryExternalDragDepth = 0;
var templateLibrarySelectedTags = [];
var templateLibrarySelectedAssetPath = '';
var templateLibraryTagModalVisible = false;
var templateLibraryDraftAssetTags = '';
var templateLibraryEditingAssetPath = '';
var templateLibraryRenameModalVisible = false;
var templateLibraryDraftAssetName = '';
var templateLibraryRenamingAssetPath = '';
var templateLibraryCardSizeResizeBound = false;
var templateLibraryStateHydrated = false;
var templateLibraryStateLoading = false;
var templateLibraryLastHydratedAt = 0;
var templateLibraryLastRefreshRequestAt = 0;
var TEMPLATE_LIBRARY_ENTER_REFRESH_INTERVAL_MS = 15000;
var TEMPLATE_LIBRARY_MIN_REFRESH_GAP_MS = 1200;
var TEMPLATE_LIBRARY_ASSET_PAGE_SIZE = 80;
var TEMPLATE_LIBRARY_DROP_MAX_BINARY_BYTES = 20 * 1024 * 1024;
var TEMPLATE_LIBRARY_DROP_SUPPORTED_EXTS = ['psd', 'psb', 'tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'txt'];
var templateLibraryContextMenuGuardBound = false;
var templateLibraryDelegatedEventsBound = false;
var templateLibraryVisibleAssetLimit = TEMPLATE_LIBRARY_ASSET_PAGE_SIZE;
var templateLibraryLastAssetViewSignature = '';
var templateLibraryLoadMoreObserver = null;
var templateLibraryRenderedRegions = {
    selectedAssetPanel: '',
    meta: '',
    tagRail: '',
    libraryList: '',
    templateList: ''
};

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getActiveTemplateLibrary() {
    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    return libraries.find(function(item) {
        return item.id === templateLibraryState.activeLibraryId;
    }) || libraries[0] || null;
}

function hasUsableTemplateLibrarySnapshot() {
    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    var assets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var activeLibrary = getActiveTemplateLibrary();
    return libraries.length > 0 || assets.length > 0 || !!activeLibrary;
}

function requestTemplateLibraryRefresh(force) {
    if (templateLibraryState.connected === false) {
        return;
    }

    var now = Date.now();
    if (!force && now - templateLibraryLastRefreshRequestAt < TEMPLATE_LIBRARY_MIN_REFRESH_GAP_MS) {
        return;
    }

    templateLibraryLastRefreshRequestAt = now;
    sendToUXP('templateLibraryRefresh');
}

function shouldRefreshTemplateLibraryOnEnter() {
    if (templateLibraryState.connected === false) {
        return false;
    }
    if (!templateLibraryStateHydrated) {
        return true;
    }
    if (!hasUsableTemplateLibrarySnapshot()) {
        return true;
    }
    return Date.now() - templateLibraryLastHydratedAt > TEMPLATE_LIBRARY_ENTER_REFRESH_INTERVAL_MS;
}

function normalizeTemplateLibraryTagList(tags) {
    var seen = {};
    return (Array.isArray(tags) ? tags : [])
        .map(function(tag) { return String(tag || '').trim(); })
        .filter(function(tag) {
            if (!tag || seen[tag]) return false;
            seen[tag] = true;
            return true;
        });
}

function parseTemplateLibraryTagInput(rawValue) {
    return normalizeTemplateLibraryTagList(String(rawValue || '').split(/[,\n\uFF0C]+/));
}

function getTemplateLibraryAssetGlyph(item) {
    var assetType = String(item?.assetType || '');
    var format = String(item?.fileFormat || '').toLowerCase();
    if (assetType === 'text' || format === 'txt') return 'TXT';
    if (assetType === 'vector' || format === 'svg') return 'SVG';
    if (format === 'psd') return 'PSD';
    if (format === 'psb') return 'PSB';
    if (format === 'tif' || format === 'tiff') return 'TIF';
    if (format === 'png') return 'PNG';
    if (format === 'jpg' || format === 'jpeg') return 'JPG';
    if (format === 'webp') return 'WEBP';
    return 'FILE';
}

function getTemplateLibraryAssetFormatClass(item) {
    var format = String(item?.fileFormat || '').toLowerCase();
    if (format === 'txt') return 'format-file';
    if (format === 'svg') return 'format-png';
    if (format === 'tiff') return 'format-tif';
    if (['psd', 'psb', 'tif', 'png', 'jpg', 'jpeg', 'webp'].includes(format)) {
        return 'format-' + format;
    }
    return 'format-file';
}

function matchesTemplateLibraryAssetQuery(item, query) {
    var normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    var tags = Array.isArray(item?.tags) ? item.tags : [];
    var haystack = [
        item?.name,
        item?.relativePath,
        item?.fileFormat,
        item?.assetType,
        item?.textPreview,
        tags.join(' ')
    ].map(function(value) {
        return String(value || '').trim().toLowerCase();
    }).filter(Boolean);

    return haystack.some(function(value) {
        return value.includes(normalizedQuery);
    });
}

function getTemplateLibraryVisibleAssets() {
    var assets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var selectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags);

    return assets.filter(function(item) {
        if (!matchesTemplateLibraryAssetQuery(item, templateLibraryAssetQuery)) {
            return false;
        }

        if (selectedTags.length === 0) {
            return true;
        }

        var itemTags = normalizeTemplateLibraryTagList(item?.tags || []);
        if (itemTags.length === 0) {
            return false;
        }

        return selectedTags.some(function(tag) {
            return itemTags.includes(tag);
        });
    });
}

function buildTemplateLibraryAssetViewSignature(activeLibrary, assets) {
    var list = Array.isArray(assets) ? assets : [];
    var selectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags).join('|');
    var firstPath = String(list[0]?.relativePath || '');
    var lastPath = String(list[list.length - 1]?.relativePath || '');
    return [
        String(activeLibrary?.id || ''),
        String(templateLibraryAssetQuery || '').trim().toLowerCase(),
        selectedTags,
        String(list.length),
        firstPath,
        lastPath
    ].join('::');
}

function disconnectTemplateLibraryLoadMoreObserver() {
    if (templateLibraryLoadMoreObserver) {
        templateLibraryLoadMoreObserver.disconnect();
        templateLibraryLoadMoreObserver = null;
    }
}

function requestNextTemplateLibraryAssetPage() {
    var filteredAssets = getTemplateLibraryVisibleAssets();
    if (templateLibraryVisibleAssetLimit >= filteredAssets.length) {
        return;
    }
    templateLibraryVisibleAssetLimit = Math.min(
        filteredAssets.length,
        templateLibraryVisibleAssetLimit + TEMPLATE_LIBRARY_ASSET_PAGE_SIZE
    );
    renderTemplateLibraryStateV2(templateLibraryState);
}

function bindTemplateLibraryLoadMoreObserver() {
    disconnectTemplateLibraryLoadMoreObserver();

    var sentinel = document.getElementById('templateLibraryLoadMoreSentinel');
    if (!sentinel || typeof window.IntersectionObserver !== 'function') {
        return;
    }

    var root = document.querySelector('#pageTemplateLibrary .morph-main');
    templateLibraryLoadMoreObserver = new IntersectionObserver(function(entries) {
        if (entries.some(function(entry) { return entry.isIntersecting; })) {
            requestNextTemplateLibraryAssetPage();
        }
    }, {
        root: root || null,
        rootMargin: '320px 0px 320px 0px'
    });
    templateLibraryLoadMoreObserver.observe(sentinel);
}

function renderTemplateLibraryMetaSummary(totalAssets, visibleAssets, totalTags) {
    var pills = [
        '<span class="template-library-meta-pill">' + escapeHtml(String(totalAssets)) + ' \u4e2a\u7d20\u6750</span>',
        '<span class="template-library-meta-pill">' + escapeHtml(String(totalTags)) + ' \u4e2a\u6807\u7b7e</span>'
    ];

    if (Number(visibleAssets) !== Number(totalAssets)) {
        pills.push('<span class="template-library-meta-pill">\u7b5b\u9009\u7ed3\u679c ' + escapeHtml(String(visibleAssets)) + '</span>');
    }

    return pills.join('');
}

function getTemplateLibraryAssetTypeLabel(item) {
    var assetType = String(item?.assetType || '').trim().toLowerCase();
    if (assetType === 'design-file') return '\u8bbe\u8ba1\u6587\u4ef6';
    if (assetType === 'image') return '\u56fe\u7247';
    if (assetType === 'text') return '\u6587\u672c';
    if (assetType === 'vector') return '\u77e2\u91cf';
    return '\u7d20\u6750';
}

function renderTemplateLibraryTagFilterBar() {
    var availableTags = Array.isArray(templateLibraryState.tags) ? templateLibraryState.tags : [];
    var activeTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags);
    var totalAssets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets.length : 0;

    return [
        '<button type="button" class="template-tag-filter' + (activeTags.length === 0 ? ' is-active' : '') + '" data-tag="">',
        '<span class="template-tag-filter-name">\u5168\u90e8</span>',
        '<span class="template-tag-filter-count">' + escapeHtml(String(totalAssets)) + '</span>',
        '</button>',
        availableTags.map(function(tagStat) {
            var name = String(tagStat?.name || '').trim();
            if (!name) {
                return '';
            }
            var count = Number(tagStat?.count || 0);
            var isActive = activeTags.includes(name);
            return [
                '<button type="button" class="template-tag-filter' + (isActive ? ' is-active' : '') + '" data-tag="' + escapeHtml(name) + '">',
                '<span class="template-tag-filter-name">' + escapeHtml(name) + '</span>',
                '<span class="template-tag-filter-count">' + escapeHtml(String(count)) + '</span>',
                '</button>'
            ].join('');
        }).join('')
    ].join('');
}

function getSelectedTemplateLibraryAsset() {
    var selectedPath = String(templateLibrarySelectedAssetPath || '').trim();
    if (!selectedPath) {
        return null;
    }
    return findTemplateLibraryAssetByRelativePath(selectedPath);
}

function openTemplateLibraryAssetTagEditor(relativePath) {
    var asset = findTemplateLibraryAssetByRelativePath(relativePath);
    if (!asset) {
        return;
    }
    templateLibrarySelectedAssetPath = String(asset.relativePath || '').trim();
    templateLibraryEditingAssetPath = templateLibrarySelectedAssetPath;
    templateLibraryDraftAssetTags = normalizeTemplateLibraryTagList(asset.tags || []).join(', ');
    templateLibraryTagModalVisible = true;
    renderTemplateLibraryStateV2(templateLibraryState);
}

function openTemplateLibraryAssetRenameEditor(relativePath) {
    var asset = findTemplateLibraryAssetByRelativePath(relativePath);
    if (!asset) {
        return;
    }
    templateLibrarySelectedAssetPath = String(asset.relativePath || '').trim();
    templateLibraryRenamingAssetPath = templateLibrarySelectedAssetPath;
    templateLibraryDraftAssetName = String(asset.name || '').trim();
    templateLibraryRenameModalVisible = true;
    renderTemplateLibraryStateV2(templateLibraryState);
}

function renderTemplateLibrarySelectedAssetPanel(item) {
    if (!item) {
        return '';
    }

    var assetName = escapeHtml(item?.name || 'Untitled asset');
    var relativePath = escapeHtml(item?.relativePath || '');
    var typeLabel = escapeHtml(getTemplateLibraryAssetTypeLabel(item));
    var formatLabel = escapeHtml(String(item?.fileFormat || '').toUpperCase() || 'FILE');
    var tags = normalizeTemplateLibraryTagList(item?.tags || []);
    var tagsHtml = tags.length > 0
        ? tags.map(function(tag) {
            return '<span class="template-library-selection-tag">' + escapeHtml(tag) + '</span>';
        }).join('')
        : '<span class="template-library-selection-tag is-empty">\u672a\u6dfb\u52a0\u6807\u7b7e</span>';

    return [
        '<div class="template-library-selection-panel">',
        '<div class="template-library-selection-head">',
        '<div class="template-library-selection-kicker">\u5df2\u9009\u7d20\u6750</div>',
        '<button type="button" class="template-library-selection-action" id="btnTemplateLibraryRenameSelected">\u91cd\u547d\u540d</button>',
        '<button type="button" class="template-library-selection-action" id="btnTemplateLibraryEditSelectedTags">\u6dfb\u52a0\u6807\u7b7e</button>',
        '</div>',
        '<div class="template-library-selection-title">' + assetName + '</div>',
        '<div class="template-library-selection-path">' + relativePath + '</div>',
        '<div class="template-library-meta-line template-library-selection-meta">',
        '<span class="template-library-meta-pill">' + formatLabel + '</span>',
        '<span class="template-library-meta-pill">' + typeLabel + '</span>',
        '</div>',
        '<div class="template-library-selection-tags">' + tagsHtml + '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryCard(item, isActive) {
    var subtitle = item?.dirPath
        ? '\u5df2\u8fde\u63a5\u672c\u5730\u76ee\u5f55'
        : '\u5c1a\u672a\u914d\u7f6e\u76ee\u5f55';
    return [
        '<button type="button" class="template-library-card template-select-library-btn' + (isActive ? ' is-active' : '') + '" data-library-id="' + escapeHtml(item?.id || '') + '">',
        '<div class="template-library-card-main">',
        '<div class="template-library-card-title-row">',
        '<div class="template-library-card-title">' + escapeHtml(item?.name || '\u672a\u547d\u540d\u8bbe\u8ba1\u5e93') + '</div>',
        isActive ? '<span class="template-library-badge">\u5f53\u524d</span>' : '',
        '</div>',
        '<div class="template-library-card-subtitle">' + escapeHtml(subtitle) + '</div>',
        '</div>',
        '<span class="template-library-enter">&#8250;</span>',
        '</button>'
    ].join('');
}

function renderTemplateLibraryAssetItem(item) {
    var glyph = getTemplateLibraryAssetGlyph(item);
    var formatClass = getTemplateLibraryAssetFormatClass(item);
    var thumb = String(item?.thumbnailUrl || '').trim();
    var textPreview = String(item?.textPreview || '').trim();
    var hasThumb = !!thumb;
    var hasTextPreview = !hasThumb && !!textPreview;
    var previewHtml = thumb
        ? '<img class="template-asset-thumb" src="' + escapeHtml(thumb) + '" alt="' + escapeHtml(item?.name || 'asset') + '" draggable="false" />'
        : hasTextPreview
            ? '<div class="template-asset-text-preview">' + escapeHtml(textPreview) + '</div>'
            : escapeHtml(glyph);
    var previewClasses = [
        'template-asset-preview',
        formatClass,
        hasThumb ? 'has-thumb' : '',
        hasTextPreview ? 'has-text-preview' : ''
    ].filter(Boolean).join(' ');
    var assetName = escapeHtml(item?.name || 'Untitled asset');
    var formatLabel = escapeHtml(String(item?.fileFormat || '').toUpperCase() || 'FILE');
    var tags = normalizeTemplateLibraryTagList(item?.tags || []).join(', ');
    var isSelected = String(item?.relativePath || '').trim() === String(templateLibrarySelectedAssetPath || '').trim();

    return [
        '<div class="template-item-card template-item-card-waterfall template-library-asset-card' + (isSelected ? ' is-selected' : '') + '" draggable="true"',
        ' data-relative-path="' + escapeHtml(item?.relativePath || '') + '"',
        ' data-asset-type="' + escapeHtml(item?.assetType || '') + '"',
        ' data-name="' + escapeHtml(item?.name || '') + '"',
        ' data-template-id="' + escapeHtml(item?.templateId || '') + '"',
        ' data-tags="' + escapeHtml(tags) + '">',
        '<div class="' + previewClasses + '">',
        '<div class="template-item-preview-meta"><div class="template-file-chip template-file-chip-overlay">' + formatLabel + '</div></div>',
        previewHtml,
        '</div>',
        '<div class="template-item-body">',
        '<div class="template-item-head">',
        '<div class="template-item-title" title="' + assetName + '">' + assetName + '</div>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryDropzone(isPersistent) {
    return [
        '<div class="design-library-drop-hint' + (isPersistent ? ' is-persistent' : '') + '" id="templateLibraryDropHint">',
        '<div class="design-library-drop-hint-card">',
        '<div class="design-library-drop-hint-icon">+</div>',
        '<div class="design-library-drop-hint-title">\u91ca\u653e\u4ee5\u5bfc\u5165\u5230\u8bbe\u8ba1\u5e93</div>',
        '<div class="design-library-drop-hint-desc">\u652f\u6301\u5916\u90e8\u6587\u4ef6\u62d6\u5165\uff0c\u4e5f\u652f\u6301\u628a Photoshop \u5f53\u524d\u9009\u4e2d\u62d6\u5165\u8fd9\u91cc</div>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryLoadingState(title, description) {
    return [
        '<div class="template-loading-state">',
        '<div class="template-loading-copy">',
        '<div class="template-loading-title">' + escapeHtml(title || '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93...') + '</div>',
        '<div class="template-loading-desc">' + escapeHtml(description || '\u6b63\u5728\u540c\u6b65\u8bbe\u8ba1\u5e93\u72b6\u6001\uff0c\u8bf7\u7a0d\u7b49\u3002') + '</div>',
        '</div>',
        '<div class="template-loading-skeletons">',
        '<div class="template-loading-card"></div>',
        '<div class="template-loading-card is-short"></div>',
        '<div class="template-loading-card"></div>',
        '</div>',
        '</div>'
    ].join('');
}

function setTemplateLibraryRegionHtml(regionKey, element, html) {
    if (!element) {
        return false;
    }
    var nextHtml = String(html || '');
    if (templateLibraryRenderedRegions[regionKey] === nextHtml) {
        return false;
    }
    element.innerHTML = nextHtml;
    templateLibraryRenderedRegions[regionKey] = nextHtml;
    return true;
}

function closeTemplateLibraryContextMenu() {
    document.getElementById('templateLibraryContextMenu')?.remove();
    document.removeEventListener('click', closeTemplateLibraryContextMenu);
}

function closeTemplateLibraryActionsMenu() {
    document.getElementById('templateLibraryActionsMenu')?.remove();
    document.removeEventListener('click', closeTemplateLibraryActionsMenu);
}

function bindTemplateLibraryContextMenuGuard() {
    if (templateLibraryContextMenuGuardBound) {
        return;
    }

    templateLibraryContextMenuGuardBound = true;
    document.addEventListener('contextmenu', function(event) {
        var page = document.getElementById('pageTemplateLibrary');
        if (!page || !page.contains(event.target)) {
            return;
        }

        if (event.defaultPrevented) {
            return;
        }

        var target = event.target;
        if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) {
            return;
        }

        if (target && target.closest && target.closest('.template-library-asset-card, .template-library-card, #templateLibraryContextMenu, #templateLibraryActionsMenu')) {
            return;
        }

        event.preventDefault();
        closeTemplateLibraryContextMenu();
        closeTemplateLibraryActionsMenu();
    });
}

function clampTemplateLibraryCardSize(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return 52;
    return Math.max(0, Math.min(100, numeric));
}

function getTemplateLibraryCardMetrics(percent, availableWidth) {
    var waterfallGap = 8;
    var safeAvailableWidth = Math.max(160, Number(availableWidth) || 0);
    var minWidth = Math.min(108, Math.max(88, safeAvailableWidth / 3.1));
    var maxWidth = Math.max(minWidth + 72, Math.min(safeAvailableWidth, 320));
    var normalized = clampTemplateLibraryCardSize(percent) / 100;
    var waterfallWidth = minWidth + (maxWidth - minWidth) * normalized;
    var waterfallPlaceholderHeight = Math.max(74, waterfallWidth * 0.82);

    return {
        gap: waterfallGap,
        width: waterfallWidth,
        placeholderHeight: waterfallPlaceholderHeight,
        minWidth: minWidth,
        maxWidth: maxWidth
    };
}

function applyTemplateLibraryCardSize() {
    var page = document.getElementById('pageTemplateLibrary');
    var mainEl = page?.querySelector('.morph-main');
    if (!mainEl) return;
    var listEl = document.getElementById('templateList');

    var percent = clampTemplateLibraryCardSize(templateLibraryCardSize);
    var availableWidth = Math.max(0, (listEl?.clientWidth || mainEl.clientWidth || 0) - 2);
    var metrics = getTemplateLibraryCardMetrics(percent, availableWidth);

    mainEl.style.setProperty('--template-library-waterfall-column-width', metrics.width.toFixed(2) + 'px');
    mainEl.style.setProperty('--template-library-waterfall-placeholder-height', metrics.placeholderHeight.toFixed(2) + 'px');
    mainEl.style.setProperty('--template-library-waterfall-column-gap', metrics.gap + 'px');
    mainEl.style.setProperty('--template-library-waterfall-layout-width', '100%');
}

function bindTemplateLibraryCardSizeSlider() {
    var slider = document.getElementById('templateLibraryCardSizeSlider');
    if (!slider) return;

    var track = slider.querySelector('.custom-slider-track');
    var fill = slider.querySelector('.custom-slider-fill');
    var thumb = slider.querySelector('.custom-slider-thumb');
    if (!track || !fill || !thumb) return;

    var setValue = function(nextValue) {
        var percent = Math.round(clampTemplateLibraryCardSize(nextValue) * 100) / 100;
        templateLibraryCardSize = percent;
        fill.style.width = percent.toFixed(2) + '%';
        thumb.style.left = percent.toFixed(2) + '%';
        slider.dataset.value = percent.toFixed(2);
        applyTemplateLibraryCardSize();
    };

    setValue(templateLibraryCardSize);
    if (!templateLibraryCardSizeResizeBound) {
        window.addEventListener('resize', applyTemplateLibraryCardSize);
        templateLibraryCardSizeResizeBound = true;
    }

    var isDragging = false;
    var updateFromClientX = function(clientX) {
        var rect = track.getBoundingClientRect();
        if (!rect.width) return;
        var percent = ((clientX - rect.left) / rect.width) * 100;
        setValue(percent);
    };

    slider.onpointerdown = function(event) {
        isDragging = true;
        slider.classList.add('dragging');
        slider.setPointerCapture(event.pointerId);
        updateFromClientX(event.clientX);
    };

    slider.onpointermove = function(event) {
        if (!isDragging) return;
        updateFromClientX(event.clientX);
    };

    slider.onpointerup = function(event) {
        isDragging = false;
        slider.classList.remove('dragging');
        if (slider.hasPointerCapture?.(event.pointerId)) {
            slider.releasePointerCapture(event.pointerId);
        }
    };

    slider.onpointercancel = function(event) {
        isDragging = false;
        slider.classList.remove('dragging');
        if (slider.hasPointerCapture?.(event.pointerId)) {
            slider.releasePointerCapture(event.pointerId);
        }
    };
}

function getTemplateLibraryDroppedFileExtension(file) {
    var name = String(file?.name || '').trim();
    var dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function isTemplateLibrarySupportedDroppedFile(file) {
    var extension = getTemplateLibraryDroppedFileExtension(file);
    return TEMPLATE_LIBRARY_DROP_SUPPORTED_EXTS.indexOf(extension) >= 0;
}

function readTemplateLibraryDroppedFile(file) {
    return new Promise(function(resolve, reject) {
        var name = String(file?.name || '').trim();
        var extension = getTemplateLibraryDroppedFileExtension(file);
        if (!name || !extension || !isTemplateLibrarySupportedDroppedFile(file)) {
            resolve(null);
            return;
        }

        var size = Number(file?.size || 0);
        if (Number.isFinite(size) && size > TEMPLATE_LIBRARY_DROP_MAX_BINARY_BYTES) {
            reject(new Error('文件过大，无法通过拖拽直接导入：' + name));
            return;
        }

        var reader = new FileReader();
        reader.onerror = function() {
            reject(new Error('读取拖拽文件失败：' + name));
        };
        reader.onload = function(event) {
            var result = event?.target?.result;
            var item = {
                name: name,
                extension: extension,
                size: Number.isFinite(size) ? size : 0,
                mimeType: String(file?.type || '')
            };
            if (extension === 'txt') {
                item.textContent = typeof result === 'string' ? result : '';
            } else {
                item.dataUrl = typeof result === 'string' ? result : '';
            }
            resolve(item);
        };

        if (extension === 'txt') {
            reader.readAsText(file, 'utf-8');
        } else {
            reader.readAsDataURL(file);
        }
    });
}

async function readTemplateLibraryDroppedFiles(filesWithoutPath) {
    var droppedFiles = [];
    for (var i = 0; i < filesWithoutPath.length; i += 1) {
        var item = await readTemplateLibraryDroppedFile(filesWithoutPath[i]);
        if (item) {
            droppedFiles.push(item);
        }
    }
    return droppedFiles;
}

function bindTemplateLibraryDropzone(activeLibrary) {
    var dropSurface = document.getElementById('templateLibraryDropSurface') || document.getElementById('templateList');
    if (!dropSurface || !activeLibrary) return;

    dropSurface.classList.add('design-library-surface');
    document.getElementById('templateLibraryDropzone')?.remove();

    if (!document.getElementById('templateLibraryDropHint')) {
        dropSurface.insertAdjacentHTML('afterbegin', renderTemplateLibraryDropzone(true));
    }

    function sendImport(filePaths, droppedFiles) {
        var payload = {
            libraryId: activeLibrary.id,
            relativePath: templateLibraryState.relativePath || ''
        };
        if (Array.isArray(filePaths) && filePaths.length > 0) {
            payload.filePaths = filePaths;
        }
        if (Array.isArray(droppedFiles) && droppedFiles.length > 0) {
            payload.droppedFiles = droppedFiles;
        }
        sendToUXP('templateLibraryImportFiles', payload);
    }

    function clearDropState() {
        templateLibraryExternalDragDepth = 0;
        dropSurface.classList.remove('is-drop-active');
    }

    dropSurface.ondragenter = function(event) {
        event.preventDefault();
        templateLibraryExternalDragDepth += 1;
        dropSurface.classList.add('is-drop-active');
    };
    dropSurface.ondragover = function(event) {
        event.preventDefault();
        dropSurface.classList.add('is-drop-active');
    };
    dropSurface.ondragleave = function(event) {
        event.preventDefault();
        templateLibraryExternalDragDepth = Math.max(0, templateLibraryExternalDragDepth - 1);
        if (templateLibraryExternalDragDepth === 0) {
            dropSurface.classList.remove('is-drop-active');
        }
    };
    dropSurface.ondrop = async function(event) {
        event.preventDefault();
        clearDropState();

        var droppedFiles = Array.from(event.dataTransfer?.files || []);
        var filePaths = droppedFiles
            .map(function(file) { return String(file?.path || '').trim(); })
            .filter(Boolean);

        if (filePaths.length > 0) {
            var filesWithoutPath = droppedFiles.filter(function(file) {
                return !String(file?.path || '').trim();
            });
            var inMemoryDroppedFiles = [];
            if (filesWithoutPath.length > 0) {
                try {
                    inMemoryDroppedFiles = await readTemplateLibraryDroppedFiles(filesWithoutPath);
                } catch (error) {
                    console.error('[DesignLibrary] Failed to read dropped files:', error);
                    if (typeof showToast === 'function') {
                        showToast(error?.message || '读取拖拽文件失败', 'error');
                    }
                    return;
                }
            }
            sendImport(filePaths, inMemoryDroppedFiles);
            return;
        }

        if (droppedFiles.length > 0) {
            try {
                var inMemoryFiles = await readTemplateLibraryDroppedFiles(droppedFiles);
                if (inMemoryFiles.length === 0) {
                    if (typeof showToast === 'function') {
                        showToast('没有可导入的设计资产文件', 'warning');
                    }
                    return;
                }
                sendImport([], inMemoryFiles);
            } catch (error) {
                console.error('[DesignLibrary] Failed to read dropped files:', error);
                if (typeof showToast === 'function') {
                    showToast(error?.message || '读取拖拽文件失败', 'error');
                }
            }
            return;
        }

        sendToUXP('templateLibraryImportSelection', {
            libraryId: activeLibrary.id,
            relativePath: templateLibraryState.relativePath || ''
        });
    };
}

function openTemplateLibraryActionsMenu(event) {
    event.preventDefault();
    closeTemplateLibraryActionsMenu();

    var menu = document.createElement('div');
    menu.id = 'templateLibraryActionsMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 240) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="import-files">\u5bfc\u5165\u6587\u4ef6</button>',
        '<button class="template-context-item" data-action="import-selection">\u5bfc\u5165\u5f53\u524d\u9009\u4e2d</button>',
        '<button class="template-context-item" data-action="save-current">\u6dfb\u52a0\u5f53\u524d\u6587\u6863</button>',
        '<button class="template-context-item" data-action="set-dir">\u8bbe\u7f6e\u76ee\u5f55</button>',
        '<button class="template-context-item" data-action="remove-library">\u5220\u9664\u8bbe\u8ba1\u5e93</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'import-files') {
                sendToUXP('templateLibraryImportFiles', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    relativePath: templateLibraryState.relativePath || ''
                });
            } else if (action === 'import-selection') {
                sendToUXP('templateLibraryImportSelection', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    relativePath: templateLibraryState.relativePath || ''
                });
            } else if (action === 'save-current') {
                sendToUXP('templateLibrarySaveCurrentDoc', {
                    libraryId: templateLibraryState.activeLibraryId || '',
                    description: '',
                    tags: ''
                });
            } else if (action === 'set-dir') {
                sendToUXP('templateLibraryAddDir', {
                    libraryId: templateLibraryState.activeLibraryId || ''
                });
            } else if (action === 'remove-library') {
                sendToUXP('templateLibraryRemove', {
                    id: templateLibraryState.activeLibraryId || ''
                });
            }
            closeTemplateLibraryActionsMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryActionsMenu, { once: true });
    }, 0);
}

function openTemplateLibraryLibraryContextMenu(event, library) {
    if (!library) return;
    event.preventDefault();
    closeTemplateLibraryContextMenu();

    var menu = document.createElement('div');
    menu.id = 'templateLibraryContextMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 190) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="open">\u6253\u5f00\u8bbe\u8ba1\u5e93</button>',
        '<button class="template-context-item" data-action="set-dir">\u8bbe\u7f6e\u76ee\u5f55</button>',
        '<button class="template-context-item" data-action="remove">\u5220\u9664\u8bbe\u8ba1\u5e93</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'open') {
                templateLibrarySelectedAssetPath = '';
                templateLibraryView = 'detail';
                renderTemplateLibraryStateV2(templateLibraryState);
                sendToUXP('templateLibrarySelect', { id: library.id });
            } else if (action === 'set-dir') {
                sendToUXP('templateLibraryAddDir', { libraryId: library.id });
            } else if (action === 'remove') {
                sendToUXP('templateLibraryRemove', { id: library.id });
            }
            closeTemplateLibraryContextMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryContextMenu, { once: true });
    }, 0);
}

function openTemplateLibraryContextMenu(event, item, activeLibrary) {
    event.preventDefault();
    closeTemplateLibraryContextMenu();

    var menu = document.createElement('div');
    var isTextAsset = String(item?.assetType || '') === 'text';

    menu.id = 'templateLibraryContextMenu';
    menu.className = 'template-context-menu';
    menu.style.left = Math.min(event.clientX, window.innerWidth - 176) + 'px';
    menu.style.top = Math.min(event.clientY, window.innerHeight - 190) + 'px';
    menu.innerHTML = [
        '<button class="template-context-item" data-action="place">\u7f6e\u5165\u5230\u6587\u6863</button>',
        isTextAsset ? '' : '<button class="template-context-item" data-action="open">\u6253\u5f00\u6e90\u6587\u4ef6</button>',
        '<button class="template-context-item" data-action="rename">\u91cd\u547d\u540d</button>',
        '<button class="template-context-item" data-action="edit-tags">\u7f16\u8f91\u6807\u7b7e</button>',
        '<button class="template-context-item" data-action="delete">\u5220\u9664</button>'
    ].join('');

    document.body.appendChild(menu);
    menu.querySelectorAll('.template-context-item').forEach(function(btn) {
        btn.addEventListener('click', function(clickEvent) {
            clickEvent.stopPropagation();
            var action = btn.getAttribute('data-action') || '';
            if (action === 'place') {
                sendToUXP('templateLibraryPlaceAsset', {
                    relativePath: item.relativePath || '',
                    name: item.name || '',
                    assetType: item.assetType || '',
                    libraryId: templateLibraryState.activeLibraryId || '',
                    dirToken: activeLibrary?.dirToken || '',
                    dirPath: activeLibrary?.dirPath || ''
                });
            } else if (action === 'open') {
                sendToUXP('templateLibraryOpenTemplate', {
                    relativePath: item.relativePath || '',
                    assetType: item.assetType || '',
                    libraryId: templateLibraryState.activeLibraryId || '',
                    dirToken: activeLibrary?.dirToken || '',
                    dirPath: activeLibrary?.dirPath || ''
                });
            } else if (action === 'edit-tags') {
                openTemplateLibraryAssetTagEditor(String(item?.relativePath || '').trim());
            } else if (action === 'rename') {
                openTemplateLibraryAssetRenameEditor(String(item?.relativePath || '').trim());
            } else if (action === 'delete') {
                sendToUXP('templateLibraryDeleteTemplate', {
                    id: item.templateId || '',
                    relativePath: item.relativePath || '',
                    currentRelativePath: '',
                    libraryId: templateLibraryState.activeLibraryId || ''
                });
            }
            closeTemplateLibraryContextMenu();
        });
    });

    setTimeout(function() {
        document.addEventListener('click', closeTemplateLibraryContextMenu, { once: true });
    }, 0);
}
function findTemplateLibraryAssetByRelativePath(relativePath) {
    var target = String(relativePath || '').trim();
    return (Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : []).find(function(item) {
        return String(item?.relativePath || '').trim() === target;
    }) || null;
}

function renderTemplateLibraryTagEditorModal() {
    if (!templateLibraryTagModalVisible) {
        return '<div class="template-modal-overlay" id="templateLibraryTagModal" style="display:none;"></div>';
    }

    var activeAsset = findTemplateLibraryAssetByRelativePath(templateLibraryEditingAssetPath);
    var assetName = escapeHtml(activeAsset?.name || '\u5f53\u524d\u7d20\u6750');
    return [
        '<div class="template-modal-overlay" id="templateLibraryTagModal">',
        '<div class="template-modal-card">',
        '<div class="template-modal-title">\u7f16\u8f91\u6807\u7b7e</div>',
        '<div class="template-modal-note">\u4e3a ' + assetName + ' \u8bbe\u7f6e\u6807\u7b7e\uff0c\u4f7f\u7528\u9017\u53f7\u5206\u9694\u3002</div>',
        '<div class="template-modal-field">',
        '<div class="template-form-label">\u6807\u7b7e</div>',
        '<input id="templateLibraryAssetTagsInput" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a\u4e3b\u56fe, \u889c\u5b50, \u8be6\u60c5\u9875" value="' + escapeHtml(templateLibraryDraftAssetTags) + '" />',
        '</div>',
        '<div class="template-modal-actions">',
        '<button class="btn-small" id="btnTemplateLibraryAssetTagsCancel">\u53d6\u6d88</button>',
        '<button class="btn-small" id="btnTemplateLibraryAssetTagsSave">\u4fdd\u5b58</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function renderTemplateLibraryRenameEditorModal() {
    if (!templateLibraryRenameModalVisible) {
        return '<div class="template-modal-overlay" id="templateLibraryRenameModal" style="display:none;"></div>';
    }

    var activeAsset = findTemplateLibraryAssetByRelativePath(templateLibraryRenamingAssetPath);
    var assetName = escapeHtml(activeAsset?.name || '\u5f53\u524d\u7d20\u6750');
    return [
        '<div class="template-modal-overlay" id="templateLibraryRenameModal">',
        '<div class="template-modal-card">',
        '<div class="template-modal-title">\u91cd\u547d\u540d\u7d20\u6750</div>',
        '<div class="template-modal-note">\u4fee\u6539 ' + assetName + ' \u7684\u663e\u793a\u540d\u548c\u5305\u5185\u6e90\u6587\u4ef6\u540d\u3002</div>',
        '<div class="template-modal-field">',
        '<div class="template-form-label">\u7d20\u6750\u540d\u79f0</div>',
        '<input id="templateLibraryAssetNameInput" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a2\u53cc\u88c5" value="' + escapeHtml(templateLibraryDraftAssetName) + '" />',
        '</div>',
        '<div class="template-modal-actions">',
        '<button class="btn-small" id="btnTemplateLibraryAssetRenameCancel">\u53d6\u6d88</button>',
        '<button class="btn-small" id="btnTemplateLibraryAssetRenameSave">\u4fdd\u5b58</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
}

function getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets) {
    if (templateLibraryState?.success === false && templateLibraryState?.error) {
        return templateLibraryState.error;
    }
    if (!activeLibrary) {
        return '\u8bf7\u5148\u521b\u5efa\u6216\u9009\u62e9\u8bbe\u8ba1\u5e93';
    }
    if (!activeLibrary.dirPath) {
        return '\u8bf7\u5148\u8bbe\u7f6e\u8bbe\u8ba1\u5e93\u76ee\u5f55';
    }
    if (!templateLibraryState.detailReady && hasRenderableCachedAssets) {
        return '\u6b63\u5728\u540c\u6b65\u6700\u65b0\u7d20\u6750\u4fe1\u606f\uff0c\u5f53\u524d\u5148\u5c55\u793a\u5df2\u7f13\u5b58\u7684\u5185\u5bb9\u3002';
    }
    if (selectedAsset) {
        return '\u5355\u51fb\u53ef\u67e5\u770b\u7d20\u6750\u4fe1\u606f\uff0c\u53cc\u51fb\u76f4\u63a5\u7f6e\u5165\uff0c\u53ef\u4ece\u9876\u90e8\u6dfb\u52a0\u6807\u7b7e\u3002';
    }
    return '\u5df2\u8fde\u63a5\u672c\u5730\u8bbe\u8ba1\u5e93\u3002\u5355\u51fb\u7d20\u6750\u53ef\u67e5\u770b\u4fe1\u606f\u5e76\u6dfb\u52a0\u6807\u7b7e\u3002';
}

function syncTemplateLibraryViewSections() {
    var listSection = document.getElementById('templateLibraryListSection');
    var detailSection = document.getElementById('templateLibraryDetailSection');
    if (listSection) {
        listSection.style.display = templateLibraryView === 'detail' ? 'none' : '';
    }
    if (detailSection) {
        detailSection.style.display = templateLibraryView === 'detail' ? '' : 'none';
    }
}

function syncTemplateLibrarySearchInputs() {
    var librarySearchInput = document.getElementById('templateLibrarySearch');
    var assetSearchInput = document.getElementById('templateAssetSearch');
    var createNameInput = document.getElementById('templateLibraryName');

    if (librarySearchInput && librarySearchInput.value !== templateLibraryQuery) {
        librarySearchInput.value = templateLibraryQuery;
    }
    if (assetSearchInput && assetSearchInput.value !== templateLibraryAssetQuery) {
        assetSearchInput.value = templateLibraryAssetQuery;
    }
    if (createNameInput && createNameInput.value !== templateLibraryDraftName) {
        createNameInput.value = templateLibraryDraftName;
    }
}

function syncTemplateLibraryCreateModal() {
    var createModal = document.getElementById('templateLibraryCreateModal');
    if (createModal) {
        createModal.style.display = templateLibraryCreateModalVisible ? '' : 'none';
    }
}

function syncTemplateLibraryTagModal() {
    var host = document.getElementById('templateLibraryTagModalHost');
    if (!host) {
        return;
    }
    host.innerHTML = renderTemplateLibraryTagEditorModal();
    bindTemplateLibraryTagModal();
}

function syncTemplateLibraryRenameModal() {
    var host = document.getElementById('templateLibraryRenameModalHost');
    if (!host) {
        return;
    }
    host.innerHTML = renderTemplateLibraryRenameEditorModal();
    bindTemplateLibraryRenameModal();
}

function syncTemplateLibraryShellState() {
    syncTemplateLibraryViewSections();
    syncTemplateLibrarySearchInputs();
    syncTemplateLibraryCreateModal();
    syncTemplateLibraryTagModal();
    syncTemplateLibraryRenameModal();
}

function syncTemplateLibrarySelectedAssetState() {
    var allAssets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var hasRenderableCachedAssets = allAssets.length > 0;
    var activeLibrary = getActiveTemplateLibrary();
    var selectedAsset = getSelectedTemplateLibraryAsset();

    if (templateLibrarySelectedAssetPath && !selectedAsset) {
        templateLibrarySelectedAssetPath = '';
    }
    selectedAsset = getSelectedTemplateLibraryAsset();

    var summaryEl = document.getElementById('templateLibrarySummary');
    var selectedAssetPanelEl = document.getElementById('templateLibrarySelectedAssetPanel');
    if (summaryEl) {
        summaryEl.textContent = getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets);
    }
    setTemplateLibraryRegionHtml('selectedAssetPanel', selectedAssetPanelEl, renderTemplateLibrarySelectedAssetPanel(selectedAsset));

    document.querySelectorAll('.template-library-asset-card').forEach(function(card) {
        var isSelected = String(card.getAttribute('data-relative-path') || '').trim() === String(templateLibrarySelectedAssetPath || '').trim();
        card.classList.toggle('is-selected', isSelected);
    });
}

function bindTemplateLibraryDelegatedInteractions() {
    if (templateLibraryDelegatedEventsBound) {
        return;
    }

    var page = document.getElementById('pageTemplateLibrary');
    if (!page) {
        return;
    }

    templateLibraryDelegatedEventsBound = true;

    page.addEventListener('click', function(event) {
        var target = event.target;
        var libraryButton = target?.closest?.('.template-select-library-btn');
        if (libraryButton) {
            var libraryId = libraryButton.getAttribute('data-library-id') || '';
            templateLibrarySelectedAssetPath = '';
            templateLibraryView = 'detail';
            renderTemplateLibraryStateV2(templateLibraryState);
            sendToUXP('templateLibrarySelect', { id: libraryId });
            return;
        }

        var editTagsButton = target?.closest?.('#btnTemplateLibraryEditSelectedTags');
        if (editTagsButton) {
            openTemplateLibraryAssetTagEditor(String(templateLibrarySelectedAssetPath || '').trim());
            return;
        }

        var renameButton = target?.closest?.('#btnTemplateLibraryRenameSelected');
        if (renameButton) {
            openTemplateLibraryAssetRenameEditor(String(templateLibrarySelectedAssetPath || '').trim());
            return;
        }

        var tagFilterButton = target?.closest?.('.template-tag-filter');
        if (tagFilterButton) {
            var tag = String(tagFilterButton.getAttribute('data-tag') || '').trim();
            if (!tag) {
                templateLibrarySelectedTags = [];
            } else if (templateLibrarySelectedTags.includes(tag)) {
                templateLibrarySelectedTags = templateLibrarySelectedTags.filter(function(item) { return item !== tag; });
            } else {
                templateLibrarySelectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags.concat(tag));
            }
            renderTemplateLibraryStateV2(templateLibraryState);
            return;
        }

        var emptyAction = target?.closest?.('#templateLibraryEmptyAction');
        if (emptyAction) {
            sendToUXP('templateLibraryImportSelection', {
                libraryId: templateLibraryState.activeLibraryId || '',
                relativePath: ''
            });
            return;
        }

        var loadMoreButton = target?.closest?.('#templateLibraryLoadMoreButton');
        if (loadMoreButton) {
            requestNextTemplateLibraryAssetPage();
            return;
        }

        var assetCard = target?.closest?.('.template-library-asset-card');
        if (assetCard) {
            var relativePath = String(assetCard.getAttribute('data-relative-path') || '').trim();
            if (relativePath && relativePath !== String(templateLibrarySelectedAssetPath || '').trim()) {
                templateLibrarySelectedAssetPath = relativePath;
                syncTemplateLibrarySelectedAssetState();
            }
        }
    });

    page.addEventListener('dblclick', function(event) {
        var assetCard = event.target?.closest?.('.template-library-asset-card');
        if (!assetCard) {
            return;
        }

        var activeLibrary = getActiveTemplateLibrary();
        sendToUXP('templateLibraryPlaceAsset', {
            relativePath: assetCard.getAttribute('data-relative-path') || '',
            name: assetCard.getAttribute('data-name') || '',
            assetType: assetCard.getAttribute('data-asset-type') || '',
            libraryId: templateLibraryState.activeLibraryId || '',
            dirToken: activeLibrary?.dirToken || '',
            dirPath: activeLibrary?.dirPath || ''
        });
    });

    page.addEventListener('contextmenu', function(event) {
        var libraryButton = event.target?.closest?.('.template-select-library-btn');
        if (libraryButton) {
            var libraryId = libraryButton.getAttribute('data-library-id') || '';
            var library = (Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : []).find(function(item) {
                return item.id === libraryId;
            }) || null;
            if (library) {
                openTemplateLibraryLibraryContextMenu(event, library);
            }
            return;
        }

        var assetCard = event.target?.closest?.('.template-library-asset-card');
        if (!assetCard) {
            return;
        }

        var relativePath = assetCard.getAttribute('data-relative-path') || '';
        var activeLibrary = getActiveTemplateLibrary();
        var asset = findTemplateLibraryAssetByRelativePath(relativePath) || {
            relativePath: relativePath,
            assetType: assetCard.getAttribute('data-asset-type') || '',
            name: assetCard.getAttribute('data-name') || '',
            templateId: assetCard.getAttribute('data-template-id') || '',
            tags: parseTemplateLibraryTagInput(assetCard.getAttribute('data-tags') || '')
        };
        openTemplateLibraryContextMenu(event, asset, activeLibrary);
    });
}

function bindTemplateLibraryTagModal() {
    document.getElementById('btnTemplateLibraryAssetTagsCancel')?.addEventListener('click', function() {
        templateLibraryTagModalVisible = false;
        templateLibraryEditingAssetPath = '';
        templateLibraryDraftAssetTags = '';
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryAssetTagsInput')?.addEventListener('input', function(event) {
        templateLibraryDraftAssetTags = event.target?.value || '';
    });
    document.getElementById('btnTemplateLibraryAssetTagsSave')?.addEventListener('click', function() {
        sendToUXP('templateLibraryUpdateAssetTags', {
            libraryId: templateLibraryState.activeLibraryId || '',
            relativePath: templateLibraryEditingAssetPath || '',
            tags: parseTemplateLibraryTagInput(templateLibraryDraftAssetTags)
        });
        templateLibraryTagModalVisible = false;
        templateLibraryEditingAssetPath = '';
        templateLibraryDraftAssetTags = '';
    });
}

function bindTemplateLibraryRenameModal() {
    document.getElementById('btnTemplateLibraryAssetRenameCancel')?.addEventListener('click', function() {
        templateLibraryRenameModalVisible = false;
        templateLibraryRenamingAssetPath = '';
        templateLibraryDraftAssetName = '';
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryAssetNameInput')?.addEventListener('input', function(event) {
        templateLibraryDraftAssetName = event.target?.value || '';
    });
    document.getElementById('btnTemplateLibraryAssetRenameSave')?.addEventListener('click', function() {
        var name = String(templateLibraryDraftAssetName || '').trim();
        if (!name) {
            if (typeof showToast === 'function') {
                showToast('\u8bf7\u8f93\u5165\u65b0\u7684\u7d20\u6750\u540d\u79f0', 'warning');
            }
            return;
        }
        sendToUXP('templateLibraryRenameAsset', {
            libraryId: templateLibraryState.activeLibraryId || '',
            relativePath: templateLibraryRenamingAssetPath || '',
            name: name
        });
        templateLibraryRenameModalVisible = false;
        templateLibraryRenamingAssetPath = '';
        templateLibraryDraftAssetName = '';
    });
}
function ensureTemplateLibraryLayout() {
    var page = document.getElementById('pageTemplateLibrary');
    var titleEl = page?.querySelector('.morph-title');
    var mainEl = page?.querySelector('.morph-main');
    if (!mainEl) return;

    if (titleEl) {
        titleEl.textContent = '\u8bbe\u8ba1\u5e93';
    }

    mainEl.innerHTML = [
        '<section class="morph-section" id="templateLibraryListSection" ' + (templateLibraryView === 'detail' ? 'style="display:none;"' : '') + '>',
        '<div class="template-topbar"><div class="template-search-shell"><span class="template-search-icon">&#9906;</span>',
        '<input id="templateLibrarySearch" class="template-search-input" type="text" placeholder="\u641c\u7d22\u8bbe\u8ba1\u5e93" value="' + escapeHtml(templateLibraryQuery) + '" />',
        '</div></div>',
        '<div class="template-section-action"><button class="template-create-trigger" id="btnTemplateLibraryOpenCreate">+ \u65b0\u5efa\u8bbe\u8ba1\u5e93</button></div>',
        '<div id="templateLibraryList" class="template-dir-list"></div>',
        '</section>',
        '<section class="morph-section" id="templateLibraryDetailSection" ' + (templateLibraryView === 'detail' ? '' : 'style="display:none;"') + '>',
        '<div class="template-library-toolbar">',
        '<div class="template-library-toolbar-main">',
        '<div class="template-library-name" id="templateLibraryActiveName">\u672a\u9009\u62e9</div>',
        '<div class="template-library-summary" id="templateLibrarySummary">\u8bf7\u5148\u521b\u5efa\u6216\u9009\u62e9\u8bbe\u8ba1\u5e93</div>',
        '<div id="templateLibrarySelectedAssetPanel"></div>',
        '<div class="template-library-meta-line" id="templateLibraryMeta"></div>',
        '<div class="template-library-tag-rail" id="templateLibraryTagRail"></div>',
        '</div>',
        '<button class="template-icon-btn template-actions-trigger" id="btnTemplateLibraryActionsMenu" title="\u8bbe\u8ba1\u5e93\u64cd\u4f5c">&#8942;</button>',
        '</div>',
        '<div class="template-topbar">',
        '<div class="template-search-shell"><span class="template-search-icon">&#9906;</span>',
        '<input id="templateAssetSearch" class="template-search-input" type="text" placeholder="\u641c\u7d22\u5f53\u524d\u8bbe\u8ba1\u5e93" value="' + escapeHtml(templateLibraryAssetQuery) + '" />',
        '</div>',
        '<div class="template-view-controls">',
        '<div class="template-size-control" title="\u8c03\u6574\u5361\u7247\u9884\u89c8\u5927\u5c0f">',
        '<span class="template-size-symbol">-</span>',
        '<div class="custom-slider template-size-slider" id="templateLibraryCardSizeSlider" data-value="' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '" data-min="0" data-max="100">',
        '<div class="custom-slider-track">',
        '<div class="custom-slider-fill" style="width: ' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '%;"></div>',
        '<div class="custom-slider-thumb" style="left: ' + clampTemplateLibraryCardSize(templateLibraryCardSize) + '%;"></div>',
        '</div>',
        '</div>',
        '<span class="template-size-symbol">+</span>',
        '</div>',
        '</div></div>',
        '<div id="templateList" class="template-list"></div>',
        '</section>',
        '<div class="template-modal-overlay" id="templateLibraryCreateModal" ' + (templateLibraryCreateModalVisible ? '' : 'style="display:none;"') + '>',
        '<div class="template-modal-card"><div class="template-modal-title">\u65b0\u5efa\u8bbe\u8ba1\u5e93</div>',
        '<div class="template-modal-field"><div class="template-form-label">\u8bbe\u8ba1\u5e93\u540d\u79f0</div>',
        '<input id="templateLibraryName" class="glass-input" type="text" placeholder="\u4f8b\u5982\uff1a\u889c\u5b50\u7d20\u6750\u5e93" value="' + escapeHtml(templateLibraryDraftName) + '" /></div>',
        '<div class="template-modal-note">\u521b\u5efa\u65f6\u4f1a\u8ba9\u4f60\u9009\u62e9\u4e00\u4e2a\u672c\u5730\u76ee\u5f55\uff0c\u540e\u7eed\u8bbe\u8ba1\u6587\u4ef6\u3001\u56fe\u7247\u548c\u6587\u6848\u90fd\u4f1a\u4fdd\u5b58\u5728\u8fd9\u91cc\u3002</div>',
        '<div class="template-modal-actions"><button class="btn-small" id="btnTemplateLibraryCreateCancel">\u53d6\u6d88</button><button class="btn-small" id="btnTemplateLibraryCreate">\u521b\u5efa</button></div>',
        '</div></div>',
        '<div id="templateLibraryTagModalHost"></div>',
        '<div id="templateLibraryRenameModalHost"></div>'
    ].join('');
    templateLibraryRenderedRegions.selectedAssetPanel = '';
    templateLibraryRenderedRegions.meta = '';
    templateLibraryRenderedRegions.tagRail = '';
    templateLibraryRenderedRegions.libraryList = '';
    templateLibraryRenderedRegions.templateList = '';

    document.getElementById('templateLibrarySearch')?.addEventListener('input', function(e) {
        templateLibraryQuery = e.target?.value || '';
        renderTemplateLibraryStateV2(templateLibraryState, { skipLayout: true });
    });
    document.getElementById('templateAssetSearch')?.addEventListener('input', function(e) {
        templateLibraryAssetQuery = e.target?.value || '';
        renderTemplateLibraryStateV2(templateLibraryState, { skipLayout: true });
    });
    document.getElementById('btnTemplateLibraryOpenCreate')?.addEventListener('click', function() {
        templateLibraryCreateModalVisible = true;
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('btnTemplateLibraryCreateCancel')?.addEventListener('click', function() {
        templateLibraryCreateModalVisible = false;
        renderTemplateLibraryStateV2(templateLibraryState);
    });
    document.getElementById('templateLibraryName')?.addEventListener('input', function(e) {
        templateLibraryDraftName = e.target?.value || '';
    });
    document.getElementById('btnTemplateLibraryCreate')?.addEventListener('click', function() {
        var name = templateLibraryDraftName || document.getElementById('templateLibraryName')?.value || '';
        templateLibraryCreateModalVisible = false;
        templateLibraryDraftName = '';
        sendToUXP('templateLibraryCreate', { name: name });
    });
    document.getElementById('btnTemplateLibraryActionsMenu')?.addEventListener('click', function(event) {
        openTemplateLibraryActionsMenu(event);
    });
    bindTemplateLibraryContextMenuGuard();
    bindTemplateLibraryDelegatedInteractions();
    bindTemplateLibraryCardSizeSlider();
    syncTemplateLibraryShellState();
    applyTemplateLibraryCardSize();
}
function renderTemplateLibraryStateV2(data, options) {
    var markHydrated = !!(options && options.markHydrated);
    if (markHydrated) {
        templateLibraryStateHydrated = true;
        templateLibraryStateLoading = false;
        templateLibraryLastHydratedAt = Date.now();
    }
    templateLibraryState = {
        success: !!data?.success,
        detailReady: !!data?.detailReady,
        connected: data?.connected !== false,
        error: String(data?.error || ''),
        settings: data?.settings || { localLibraryDirs: [], libraries: [] },
        libraries: Array.isArray(data?.libraries) ? data.libraries : [],
        activeLibraryId: String(data?.activeLibraryId || data?.settings?.activeLibraryId || ''),
        relativePath: String(data?.relativePath || ''),
        breadcrumbs: [],
        entries: [],
        assets: Array.isArray(data?.assets) ? data.assets : (Array.isArray(data?.rootAssets) ? data.rootAssets : []),
        tags: Array.isArray(data?.tags) ? data.tags : [],
        templates: Array.isArray(data?.templates) ? data.templates : [],
        storageInfo: data?.storageInfo || null
    };

    var hasLayout = !!document.getElementById('templateLibraryListSection') && !!document.getElementById('templateLibraryDetailSection');
    var availableTagNames = (Array.isArray(templateLibraryState.tags) ? templateLibraryState.tags : []).map(function(tag) {
        return String(tag?.name || '').trim();
    }).filter(Boolean);
    templateLibrarySelectedTags = normalizeTemplateLibraryTagList(templateLibrarySelectedTags).filter(function(tag) {
        return availableTagNames.includes(tag);
    });

    if (!hasLayout) {
        ensureTemplateLibraryLayout();
    }
    syncTemplateLibraryShellState();
    applyTemplateLibraryCardSize();

    var libraries = Array.isArray(templateLibraryState.libraries) ? templateLibraryState.libraries : [];
    var activeLibrary = libraries.find(function(item) {
        return item.id === templateLibraryState.activeLibraryId;
    }) || libraries[0] || null;
    var filteredLibraries = libraries.filter(function(item) {
        return !templateLibraryQuery || String(item.name || '').toLowerCase().includes(templateLibraryQuery.toLowerCase());
    });
    var filteredAssets = getTemplateLibraryVisibleAssets();
    var allAssets = Array.isArray(templateLibraryState.assets) ? templateLibraryState.assets : [];
    var assetViewSignature = buildTemplateLibraryAssetViewSignature(activeLibrary, filteredAssets);
    var hasRenderableCachedAssets = allAssets.length > 0;
    var selectedAsset = getSelectedTemplateLibraryAsset();
    if (templateLibrarySelectedAssetPath && !selectedAsset) {
        templateLibrarySelectedAssetPath = '';
    }
    selectedAsset = getSelectedTemplateLibraryAsset();
    if (assetViewSignature !== templateLibraryLastAssetViewSignature) {
        templateLibraryLastAssetViewSignature = assetViewSignature;
        templateLibraryVisibleAssetLimit = Math.min(TEMPLATE_LIBRARY_ASSET_PAGE_SIZE, filteredAssets.length || TEMPLATE_LIBRARY_ASSET_PAGE_SIZE);
    }
    var selectedAssetIndex = selectedAsset
        ? filteredAssets.findIndex(function(item) {
            return String(item?.relativePath || '').trim() === String(templateLibrarySelectedAssetPath || '').trim();
        })
        : -1;
    if (selectedAssetIndex >= templateLibraryVisibleAssetLimit) {
        templateLibraryVisibleAssetLimit = Math.min(
            filteredAssets.length,
            Math.ceil((selectedAssetIndex + 1) / TEMPLATE_LIBRARY_ASSET_PAGE_SIZE) * TEMPLATE_LIBRARY_ASSET_PAGE_SIZE
        );
    }
    var pagedAssets = filteredAssets.slice(0, templateLibraryVisibleAssetLimit);
    var hasMoreAssets = filteredAssets.length > pagedAssets.length;
    var activeNameEl = document.getElementById('templateLibraryActiveName');
    var summaryEl = document.getElementById('templateLibrarySummary');
    var selectedAssetPanelEl = document.getElementById('templateLibrarySelectedAssetPanel');
    var metaEl = document.getElementById('templateLibraryMeta');
    var tagRailEl = document.getElementById('templateLibraryTagRail');
    var libraryListEl = document.getElementById('templateLibraryList');
    var templateListEl = document.getElementById('templateList');

    if (activeNameEl) activeNameEl.textContent = activeLibrary ? activeLibrary.name : '\u672a\u9009\u62e9';
    if (summaryEl) {
        summaryEl.textContent = getTemplateLibrarySummaryText(activeLibrary, selectedAsset, hasRenderableCachedAssets);
    }
    setTemplateLibraryRegionHtml('selectedAssetPanel', selectedAssetPanelEl, renderTemplateLibrarySelectedAssetPanel(selectedAsset));
    if (metaEl) {
        setTemplateLibraryRegionHtml(
            'meta',
            metaEl,
            activeLibrary ? renderTemplateLibraryMetaSummary(allAssets.length, filteredAssets.length, availableTagNames.length) : ''
        );
    }
    if (tagRailEl) {
        setTemplateLibraryRegionHtml(
            'tagRail',
            tagRailEl,
            activeLibrary && availableTagNames.length
                ? renderTemplateLibraryTagFilterBar()
                : (activeLibrary ? '<div class="template-library-tag-empty">\u8fd8\u6ca1\u6709\u6807\u7b7e\uff0c\u53f3\u952e\u7d20\u6750\u53ef\u6dfb\u52a0\u3002</div>' : '')
        );
    }

    if (libraryListEl) {
        if (!templateLibraryStateHydrated && templateLibraryStateLoading) {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, renderTemplateLibraryLoadingState(
                '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93...',
                '\u5148\u540c\u6b65\u8bbe\u8ba1\u5e93\u5217\u8868\uff0c\u518d\u6e32\u67d3\u5185\u5bb9\u3002'
            ));
        } else if (filteredLibraries.length === 0) {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, '<div class="layer-empty">\u8fd8\u6ca1\u6709\u8bbe\u8ba1\u5e93\uff0c\u5148\u521b\u5efa\u4e00\u4e2a\u3002</div>');
        } else {
            setTemplateLibraryRegionHtml('libraryList', libraryListEl, filteredLibraries.map(function(item) {
                return renderTemplateLibraryCard(item, item.id === templateLibraryState.activeLibraryId);
            }).join(''));
        }
    }

    if (templateListEl && templateLibraryView === 'detail') {
        if (!activeLibrary) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, '<div class="layer-empty">\u8bf7\u5148\u9009\u62e9\u8bbe\u8ba1\u5e93</div>');
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (!templateLibraryState.detailReady && !hasRenderableCachedAssets) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, renderTemplateLibraryLoadingState(
                '\u6b63\u5728\u52a0\u8f7d\u8bbe\u8ba1\u5e93\u5185\u5bb9...',
                '\u5148\u6062\u590d\u7d20\u6750\u7d22\u5f15\uff0c\u518d\u8865\u5168\u7d20\u6750\u4e0e\u6807\u7b7e\u4fe1\u606f\u3002'
            ));
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (allAssets.length === 0) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, [
                '<button type="button" class="design-library-dropzone" id="templateLibraryDropzone">',
                '<span class="design-library-dropzone-title">\u62d6\u62fd\u6587\u4ef6\u5230\u8fd9\u91cc\uff0c\u6216\u70b9\u51fb\u5bfc\u5165</span>',
                '<span class="design-library-dropzone-desc">\u62d6\u5165\u5916\u90e8\u6587\u4ef6\uff0c\u6216\u628a Photoshop \u5f53\u524d\u9009\u4e2d\u62d6\u5230\u8fd9\u91cc\u5bfc\u5165</span>',
                '</button>',
                '<div class="template-empty-state" id="templateLibraryEmptyAction">',
                '<div class="template-empty-icon">+</div>',
                '<div class="template-empty-title">\u5f00\u59cb\u5efa\u8bbe\u8ba1\u5e93</div>',
                '<div class="template-empty-desc">\u5bfc\u5165\u6587\u4ef6\u3001\u5bfc\u5165\u5f53\u524d\u9009\u4e2d\uff0c\u6216\u4ece\u53f3\u4e0a\u89d2\u83dc\u5355\u6dfb\u52a0\u5f53\u524d\u6587\u6863\u3002</div>',
                '</div>'
            ].join(''));
            bindTemplateLibraryDropzone(activeLibrary);
            disconnectTemplateLibraryLoadMoreObserver();
        } else if (filteredAssets.length === 0) {
            setTemplateLibraryRegionHtml('templateList', templateListEl, [
                renderTemplateLibraryDropzone(true),
                '<div class="template-empty-state template-empty-state-compact">',
                '<div class="template-empty-title">\u6ca1\u6709\u5339\u914d\u7684\u7d20\u6750</div>',
                '<div class="template-empty-desc">\u8bd5\u8bd5\u6e05\u7a7a\u641c\u7d22\u8bcd\u6216\u53d6\u6d88\u6807\u7b7e\u7b5b\u9009\u3002</div>',
                '</div>'
            ].join(''));
            bindTemplateLibraryDropzone(activeLibrary);
            disconnectTemplateLibraryLoadMoreObserver();
        } else {
            setTemplateLibraryRegionHtml('templateList', templateListEl, [
                renderTemplateLibraryDropzone(true),
                '<div class="template-asset-waterfall">',
                pagedAssets.map(function(item) {
                    return renderTemplateLibraryAssetItem(item, activeLibrary);
                }).join(''),
                '</div>'
                ,
                hasMoreAssets ? [
                    '<div class="template-library-load-more" id="templateLibraryLoadMore">',
                    '<button type="button" class="template-library-load-more-btn" id="templateLibraryLoadMoreButton">\u7ee7\u7eed\u52a0\u8f7d</button>',
                    '<div class="template-library-load-more-meta">\u5df2\u663e\u793a ' + escapeHtml(String(pagedAssets.length)) + ' / ' + escapeHtml(String(filteredAssets.length)) + ' \u4e2a\u7d20\u6750</div>',
                    '<div class="template-library-load-more-sentinel" id="templateLibraryLoadMoreSentinel" aria-hidden="true"></div>',
                    '</div>'
                ].join('') : ''
            ].join(''));
            bindTemplateLibraryDropzone(activeLibrary);
            bindTemplateLibraryLoadMoreObserver();
        }
    } else {
        disconnectTemplateLibraryLoadMoreObserver();
    }
}
function renderTemplateLibraryState(data) {
    renderTemplateLibraryStateV2(data, { markHydrated: true });
}

window.designLibraryRuntime = {
    renderState: renderTemplateLibraryState,
    refresh: function(force) {
        requestTemplateLibraryRefresh(force !== false);
    },
    enter: function() {
        var shouldRefresh = shouldRefreshTemplateLibraryOnEnter();
        if (!templateLibraryStateHydrated) {
            templateLibraryStateLoading = true;
        }
        templateLibraryView = getActiveTemplateLibrary() ? 'detail' : 'list';
        renderTemplateLibraryStateV2(templateLibraryState);
        if (shouldRefresh) {
            requestTemplateLibraryRefresh(false);
        }
    },
    handleBack: function() {
        if (templateLibraryView !== 'detail') {
            return false;
        }
        templateLibraryView = 'list';
        renderTemplateLibraryStateV2(templateLibraryState);
        return true;
    }
};

renderTemplateLibraryStateV2(templateLibraryState);

