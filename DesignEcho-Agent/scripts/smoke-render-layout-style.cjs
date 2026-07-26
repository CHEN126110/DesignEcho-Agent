const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.json'),
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node'
  }
});

const {
  contrastRatio,
  resolveRenderLayoutStyle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'layout', 'render-layout-style.ts'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const lightStyle = resolveRenderLayoutStyle('#F6EEE8');
assert(lightStyle.pageTextColorHex !== '#FFFFFF', `light page background should not use white body text: ${JSON.stringify(lightStyle)}`);
assert(lightStyle.sellingPointTextColorHex !== '#FFFFFF', `light selling-point chip should not use white text: ${JSON.stringify(lightStyle)}`);
assert(
  contrastRatio(lightStyle.sellingPointBoxFillColorHex, lightStyle.sellingPointTextColorHex) >= 4.5,
  `selling-point chip text must be readable on light layouts: ${JSON.stringify(lightStyle)}`
);

const darkStyle = resolveRenderLayoutStyle('#111827');
assert(darkStyle.pageTextColorHex === '#FFFFFF', `dark page background should use white page text: ${JSON.stringify(darkStyle)}`);
assert(
  contrastRatio(darkStyle.sellingPointBoxFillColorHex, darkStyle.sellingPointTextColorHex) >= 4.5,
  `selling-point chip text must be readable on dark layouts: ${JSON.stringify(darkStyle)}`
);

console.log(JSON.stringify({
  success: true,
  lightStyle,
  darkStyle,
  lightSellingPointContrast: contrastRatio(lightStyle.sellingPointBoxFillColorHex, lightStyle.sellingPointTextColorHex),
  darkSellingPointContrast: contrastRatio(darkStyle.sellingPointBoxFillColorHex, darkStyle.sellingPointTextColorHex)
}, null, 2));
