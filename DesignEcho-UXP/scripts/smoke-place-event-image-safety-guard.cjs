#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function assert(condition, message, details) {
    if (!condition) {
        const error = new Error(message);
        error.details = details;
        throw error;
    }
}

function walk(dir, output = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, output);
        } else if (/\.(ts|js)$/.test(entry.name)) {
            output.push(fullPath);
        }
    }
    return output;
}

function normalizePath(filePath) {
    return path.relative(root, filePath).replace(/\\/g, '/');
}

function placeEventLineNumbers(lines) {
    const lineNumbers = [];
    lines.forEach((line, index) => {
        if (/_obj:\s*['"]placeEvent['"]/.test(line)) {
            lineNumbers.push(index + 1);
        }
    });
    return lineNumbers;
}

function windowText(lines, lineNumber, before, after) {
    const start = Math.max(0, lineNumber - before - 1);
    const end = Math.min(lines.length, lineNumber + after);
    return lines.slice(start, end).join('\n');
}

function main() {
    const files = walk(path.join(root, 'src'));
    const checked = [];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf8');
        const lines = source.split(/\r?\n/);
        const placeEventLines = placeEventLineNumbers(lines);
        if (placeEventLines.length === 0) continue;

        const relativePath = normalizePath(filePath);
        checked.push(relativePath);

        assert(
            source.includes('assertImageBytesSafeForPhotoshop('),
            `${relativePath} uses placeEvent but does not call assertImageBytesSafeForPhotoshop before Photoshop receives image bytes.`
        );

        for (const lineNumber of placeEventLines) {
            const surroundingCode = windowText(lines, lineNumber, 20, 35);
            assert(
                /dialogOptions:\s*['"]dontDisplay['"]/.test(surroundingCode),
                `${relativePath}:${lineNumber} placeEvent must suppress Photoshop native dialogs.`
            );
            assert(
                /synchronousExecution:\s*true/.test(surroundingCode),
                `${relativePath}:${lineNumber} placeEvent must use synchronous batchPlay execution.`
            );
        }
    }

    assert(checked.length > 0, 'No placeEvent usages were found; guard would not be meaningful.');

    console.log(JSON.stringify({
        success: true,
        checked,
        checks: [
            'all placeEvent files call image-safety before handing image bytes to Photoshop',
            'all placeEvent descriptors suppress native Photoshop dialogs',
            'all placeEvent calls use synchronous batchPlay execution'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(JSON.stringify({
        success: false,
        error: error && error.message ? error.message : String(error),
        details: error && error.details ? error.details : undefined
    }, null, 2));
    process.exit(1);
}
