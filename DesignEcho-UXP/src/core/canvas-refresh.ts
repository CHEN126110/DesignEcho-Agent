/**
 * 强制刷新 Photoshop 画布显示。
 *
 * 抠图、蒙版或栅格结果应用后，Photoshop 画布有时不会立即重绘。
 * 这里通过短暂切换当前图层可见性触发刷新，失败时只记录警告，
 * 不影响上层工具的真实执行结果。
 */
export async function forceRefreshCanvas(): Promise<void> {
    const { app, core, action } = require('photoshop');
    const doc = app.activeDocument;
    if (!doc) return;

    try {
        await core.executeAsModal(async () => {
            console.log('[DesignEcho] 开始刷新画布...');

            if (doc.activeLayers.length > 0) {
                const layer = doc.activeLayers[0];
                const layerId = layer.id;

                try {
                    await action.batchPlay([
                        {
                            _obj: 'hide',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });

                    await action.batchPlay([
                        {
                            _obj: 'show',
                            null: [{ _ref: 'layer', _id: layerId }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });

                    console.log('[DesignEcho] 画布刷新成功');
                } catch (e) {
                    console.log('[DesignEcho] 画布刷新失败:', e);
                }
            }
        }, { commandName: 'DesignEcho: 刷新画布' });
    } catch (error) {
        console.warn('[DesignEcho] 画布刷新出错:', error);
    }
}
