const fs = require('fs');
const path = require('path');

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';

function escapeForRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unpatch(htmlPath) {
    try {
        let content = fs.readFileSync(htmlPath, 'utf8');
        let patched = content.includes(MARKER_START);
        if (patched) {
            const regex = new RegExp(`\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`, 'g');
            content = content.replace(regex, '');
            fs.writeFileSync(htmlPath, content, 'utf8');
            console.log("SUCCESS: Removed patch from " + htmlPath);
        } else {
            console.log("INFO: No patch found in " + htmlPath);
        }

        const jsPath = path.join(path.dirname(htmlPath), PATCH_JS_NAME);
        if (fs.existsSync(jsPath)) {
            fs.unlinkSync(jsPath);
            console.log("SUCCESS: Deleted injected JS file " + jsPath);
        }
    } catch (e) {
        console.error("ERROR: Failed to unpatch " + htmlPath + " - " + e.message);
    }
}

const targetDir = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code');

function findWorkbenchHtml(dir) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const result = findWorkbenchHtml(full);
                if (result) return result;
            } else if (entry.name === 'workbench.html' && full.includes('electron-browser')) {
                return full;
            }
        }
    } catch (e) {}
    return null;
}

const targetPath = findWorkbenchHtml(targetDir);
if (!targetPath) {
    console.error("ERROR: Could not find workbench.html in " + targetDir);
    process.exit(1);
}
console.log("Found workbench.html at: " + targetPath);
console.log("Attempting to unpatch...");
unpatch(targetPath);
