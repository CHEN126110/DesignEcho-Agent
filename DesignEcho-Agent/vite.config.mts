import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM 模式下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    plugins: [react()],
    base: './',
    root: 'src/renderer',
    build: {
        target: 'chrome120',
        outDir: '../../dist/renderer',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    const normalizedId = id.replace(/\\/g, '/');

                    if (normalizedId.includes('node_modules')) {
                        if (normalizedId.includes('/node_modules/@xyflow/')) return 'workflow-vendor';
                        if (
                            normalizedId.includes('/node_modules/react/') ||
                            normalizedId.includes('/node_modules/react-dom/') ||
                            normalizedId.includes('/node_modules/scheduler/') ||
                            normalizedId.includes('/node_modules/use-sync-external-store/')
                        ) return 'react-vendor';
                        if (normalizedId.includes('/node_modules/zustand/')) return 'state-vendor';
                        return 'vendor';
                    }

                    if (normalizedId.includes('/src/renderer/services/skill-executors/')) {
                        const lowerId = normalizedId.toLowerCase();
                        if (lowerId.includes('/agent-panel-bridge')) {
                            return 'skill-agent-panel-bridge';
                        }
                        if (lowerId.includes('/sku') || lowerId.includes('sku-')) {
                            return 'skill-sku';
                        }
                        if (
                            lowerId.includes('/main-image') ||
                            lowerId.includes('project-image-analysis') ||
                            lowerId.includes('design-reference-search')
                        ) {
                            return 'skill-main-image';
                        }
                        if (lowerId.includes('/detail-page')) {
                            return 'skill-detail-page';
                        }
                        if (
                            lowerId.includes('/layout-replication') ||
                            lowerId.includes('/find-edit') ||
                            lowerId.includes('/reference')
                        ) {
                            return 'skill-layout-reference';
                        }
                        if (
                            lowerId.includes('/business-skill') ||
                            lowerId.includes('/design-planner')
                        ) {
                            return 'skill-design-governance';
                        }
                        return;
                    }
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared')
        }
    }
});
