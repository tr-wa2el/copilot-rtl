/**
 * Cleanup script — remove orphaned template literal content from extension.ts
 * after the engine refactoring.
 */
const fs = require('fs');
const content = fs.readFileSync('src/extension.ts', 'utf8');
const lines = content.split('\n');

// Find line 38 (0-indexed 37) which should end getEngineScript with "}"
// Then find the next real function: buildPatchContent
let startDelete = -1;
let endDelete = -1;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    // After getEngineScript ends, there's orphaned content starting with "'use strict';"
    if (line.trim() === "'use strict';" && i > 30 && i < 100) {
        startDelete = i;
    }
    // buildPatchContent is the next valid function after the old template literals
    if (line.includes('function buildPatchContent(version: number)') && startDelete > 0) {
        endDelete = i;
        break;
    }
}

if (startDelete > 0 && endDelete > startDelete) {
    console.log(`Deleting orphaned lines ${startDelete + 1} to ${endDelete} (0-indexed ${startDelete} to ${endDelete - 1})`);
    lines.splice(startDelete, endDelete - startDelete);
    fs.writeFileSync('src/extension.ts', lines.join('\n'), 'utf8');
    console.log('✓ Cleaned up orphaned template literal content');
    console.log(`File went from ${content.split('\n').length} to ${lines.length} lines`);
} else {
    console.log('Could not find orphaned content boundaries');
    console.log(`startDelete=${startDelete}, endDelete=${endDelete}`);
}
