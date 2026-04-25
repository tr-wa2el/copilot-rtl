import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';
const AGENT_PATCH_JS_NAME = 'copilot-rtl-agent-patch.js';
const STATE_FILE_NAME = 'copilot-rtl-state.json';
const STATE_KEY_DISABLED = 'copilotRtl.userDisabled';
const STATE_KEY_PATCHED_VERSION = 'copilotRtl.patchedVersion';

/**
 * Read the pre-bundled engine script from out/copilot-rtl-patch.js.
 * The engine is built by esbuild from src/engine/ — see build-engine.js.
 *
 * Configuration values are injected by replacing placeholder globals that
 * the engine declares with `typeof __X__ !== 'undefined' ? __X__ : default`.
 */
function getEngineScript(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string, extVersion = '0.3.0'): string {
    const enginePath = path.join(__dirname, 'copilot-rtl-patch.js');
    let script = fs.readFileSync(enginePath, 'utf8');

    // Inject configuration by prepending global declarations before the IIFE
    const config = `
// Copilot RTL Engine — injected configuration
var __RTL_FONT_FAMILY__ = ${JSON.stringify(fontFamily)};
var __RTL_FONT_SIZE__ = ${JSON.stringify(fontSize)};
var __RTL_LINE_HEIGHT__ = ${JSON.stringify(lineHeight)};
var __LTR_FONT_FAMILY__ = ${JSON.stringify(ltrFontFamily)};
var __LTR_FONT_SIZE__ = ${JSON.stringify(ltrFontSize)};
var __LTR_LINE_HEIGHT__ = ${JSON.stringify(ltrLineHeight)};
var __RTL_TEXT_ALIGN__ = ${JSON.stringify(textAlign)};
var __EXT_VERSION__ = ${JSON.stringify(extVersion)};
`;
    return config + '\n' + script;
}

function buildPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

function buildAgentPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${AGENT_PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

function firstExistingPath(candidates: string[]): string | undefined {
    for (const candidate of candidates) {
        const normalized = path.normalize(candidate);
        if (fs.existsSync(normalized)) {
            return normalized;
        }
    }
    return undefined;
}

function findFirstFileNamed(rootDir: string, fileName: string): string | undefined {
    if (!fs.existsSync(rootDir)) {
        return undefined;
    }

    const queue: string[] = [rootDir];
    let index = 0;
    const target = fileName.toLowerCase();

    while (index < queue.length) {
        const currentDir = queue[index++];
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase() === target) {
                return path.normalize(path.join(currentDir, entry.name));
            }
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                queue.push(path.join(currentDir, entry.name));
            }
        }
    }

    return undefined;
}

function findFirstMatchingFile(rootDir: string, fileNames: string[]): string | undefined {
    for (const fileName of fileNames) {
        const found = findFirstFileNamed(rootDir, fileName);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function findFirstAgentWorkbenchHtml(rootDir: string): string | undefined {
    if (!fs.existsSync(rootDir)) {
        return undefined;
    }

    const queue: string[] = [rootDir];
    let index = 0;

    while (index < queue.length) {
        const currentDir = queue[index++];
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }
            const lowerName = entry.name.toLowerCase();
            if (lowerName.endsWith('.html') && lowerName.startsWith('workbench') && lowerName.includes('agent')) {
                return path.normalize(path.join(currentDir, entry.name));
            }
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                queue.push(path.join(currentDir, entry.name));
            }
        }
    }

    return undefined;
}

/** Find Antigravity's agent chat panel HTML (workbench-jetski-agent.html). */
function getAgentHtmlPath(): string | undefined {
    try {
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        // Prefer sandbox first: recent VS Code/Cursor builds often run from electron-sandbox.
        const candidates: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
        ];

        const direct = firstExistingPath(candidates);
        if (direct) {
            return direct;
        }

        const recursiveRoots: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(appRoot, 'out', 'vs'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(execDir, 'resources', 'app', 'out', 'vs'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs'),
        ];

        for (const root of recursiveRoots) {
            const exact = findFirstMatchingFile(root, ['workbench-jetski-agent.html']);
            if (exact) {
                return exact;
            }
            const generic = findFirstAgentWorkbenchHtml(root);
            if (generic) {
                return generic;
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

function getWorkbenchHtmlPath(): string | undefined {
    try {
        // vscode.env.appRoot reliably points to the VS Code "resources/app" directory
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        const workbenchNames = [
            'workbench.html',
            'workbench.desktop.main.html',
            'workbench.desktop.esm.html',
            'workbench.esm.html',
        ];

        // Prefer sandbox first: when both files exist after an update,
        // patching browser first can modify an inactive HTML file.
        const directCandidates: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
            path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
            path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.esm.html'),
            path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.esm.html'),
            path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.esm.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.esm.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.esm.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.esm.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.html'),
        ];

        const direct = firstExistingPath(directCandidates);
        if (direct) {
            return direct;
        }

        const recursiveRoots: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(appRoot, 'out', 'vs'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(execDir, 'resources', 'app', 'out', 'vs'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs'),
        ];

        for (const root of recursiveRoots) {
            const found = findFirstMatchingFile(root, workbenchNames);
            if (found) {
                return found;
            }
        }
    } catch {
        // ignore filesystem errors
    }
    return undefined;
}

function isPatched(content: string): boolean {
    return content.includes(MARKER_START);
}

function escapeForRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSettings(): { fontFamily: string; fontSize: number; lineHeight: number; ltrFontFamily: string; ltrFontSize: number; ltrLineHeight: number; autoInputDirection: boolean; textAlign: string } {
    const cfg = vscode.workspace.getConfiguration('copilotRtl');
    return {
        fontFamily: cfg.get<string>('fontFamily', 'vazirmatn'),
        fontSize: cfg.get<number>('fontSize', 13),
        lineHeight: cfg.get<number>('lineHeight', 1.8),
        ltrFontFamily: cfg.get<string>('ltrFontFamily', ''),
        ltrFontSize: cfg.get<number>('ltrFontSize', 0),
        ltrLineHeight: cfg.get<number>('ltrLineHeight', 0),
        autoInputDirection: cfg.get<boolean>('autoInputDirection', true),
        textAlign: cfg.get<string>('textAlign', 'justify'),
    };
}

async function enablePatch(htmlPath: string, fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): Promise<{ success: boolean; error?: string }> {
    try {
        const htmlDir = path.dirname(htmlPath);
        const jsPath = path.join(htmlDir, PATCH_JS_NAME);

        // Read the extension version from package.json for the patch diagnostic log
        let extVersion = '0.3.0';
        try {
            const pkgRaw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
            extVersion = JSON.parse(pkgRaw).version ?? extVersion;
        } catch { /* use default */ }

        // Always write/overwrite the JS file (updates font settings)
        await fsp.writeFile(jsPath, getEngineScript(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign, extVersion), 'utf8');

        // Write state file for immediate live toggle (no reload needed)
        try { await fsp.writeFile(path.join(htmlDir, STATE_FILE_NAME), JSON.stringify({ enabled: true }), 'utf8'); } catch { /* ignore */ }

        let content = await fsp.readFile(htmlPath, 'utf8');
        const version = Date.now();
        const patch = buildPatchContent(version);

        // Remove existing patch first (handles re-enable after settings update)
        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
        } else {
            // Create a backup only on first-time install
            const backupPath = `${htmlPath}.bak-copilot-rtl`;
            if (!fs.existsSync(backupPath)) {
                await fsp.writeFile(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        await fsp.writeFile(htmlPath, content, 'utf8');

        // Also patch the Antigravity agent panel if it exists
        await enableAgentPatch(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function enableAgentPatch(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, textAlign: string): Promise<{ success: boolean; error?: string }> {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return { success: false, error: 'Agent HTML not found' }; }

    try {
        const htmlDir = path.dirname(agentPath);
        const jsPath = path.join(htmlDir, AGENT_PATCH_JS_NAME);

        // Write the same engine script (handles both main and agent contexts)
        await fsp.writeFile(jsPath, getEngineScript(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign), 'utf8');

        let content = await fsp.readFile(agentPath, 'utf8');
        const version = Date.now();
        const patch = buildAgentPatchContent(version);

        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
        } else {
            const backupPath = `${agentPath}.bak-copilot-rtl`;
            if (!fs.existsSync(backupPath)) {
                await fsp.writeFile(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        await fsp.writeFile(agentPath, content, 'utf8');
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function disablePatch(htmlPath: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Write state file first — running script sees it within 1.5s and shuts down (no reload needed)
        try { await fsp.writeFile(path.join(path.dirname(htmlPath), STATE_FILE_NAME), JSON.stringify({ enabled: false }), 'utf8'); } catch { /* ignore */ }

        let content = await fsp.readFile(htmlPath, 'utf8');

        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            await fsp.writeFile(htmlPath, content, 'utf8');
        }

        // Remove the JS file if it exists
        const jsPath = path.join(path.dirname(htmlPath), PATCH_JS_NAME);
        try { await fsp.unlink(jsPath); } catch { /* file may not exist */ }

        // Also clean up the agent panel
        await disableAgentPatch();

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function disableAgentPatch(): Promise<void> {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return; }

    try {
        let content = await fsp.readFile(agentPath, 'utf8');
        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            await fsp.writeFile(agentPath, content, 'utf8');
        }
        const jsPath = path.join(path.dirname(agentPath), AGENT_PATCH_JS_NAME);
        try { await fsp.unlink(jsPath); } catch { /* file may not exist */ }
    } catch {
        // ignore
    }
}

async function promptReload(message: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(message, 'Reload Now');
    if (action === 'Reload Now') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const userDisabled = context.globalState.get<boolean>(STATE_KEY_DISABLED, false);

    // ── Auto-enable on first activation ──────────────────────────────────────
    const htmlPath = getWorkbenchHtmlPath();
    if (!htmlPath) {
        vscode.window.showWarningMessage(
            'Copilot RTL: Could not locate the active workbench HTML after this update. Run "Copilot RTL: Enable" (preferably as Administrator).'
        );
    } else {
        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            if (!isPatched(content)) {
                // Only auto-enable if the user hasn't explicitly disabled it
                if (!userDisabled) {
                    const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                    const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                    if (result.success) {
                        const currentVersion = context.extension.packageJSON?.version ?? '';
                        await context.globalState.update(STATE_KEY_PATCHED_VERSION, currentVersion);
                        promptReload('Copilot RTL installed and enabled automatically. Reload to apply.');
                    } else {
                        vscode.window.showWarningMessage(
                            `Copilot RTL: Auto-enable failed — ${result.error}. Try running VS Code as Administrator.`
                        );
                    }
                }
            } else {
                // Already patched — fully re-patch (HTML + JS) so extension updates
                // take effect. enablePatch() removes the old patch and adds a new one
                // with a fresh ?v=timestamp, ensuring the browser loads the latest JS.
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                try {
                    const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                    if (result.success) {
                        // If the extension was updated (version changed), the old patch JS
                        // is still running in the current window. Prompt to reload so the
                        // new patch JS (with bug fixes / new features) takes effect.
                        const currentVersion = context.extension.packageJSON?.version ?? '';
                        const lastPatchedVersion = context.globalState.get<string>(STATE_KEY_PATCHED_VERSION, '');
                        if (currentVersion && currentVersion !== lastPatchedVersion) {
                            await context.globalState.update(STATE_KEY_PATCHED_VERSION, currentVersion);
                            promptReload(`Copilot RTL updated to v${currentVersion}. Reload to apply the new patch.`);
                        }
                    }
                } catch (patchErr: unknown) {
                    const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
                    vscode.window.showWarningMessage(
                        `Copilot RTL: Re-patch failed — ${patchMsg}. Try running VS Code as Administrator and re-installing.`
                    );
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showWarningMessage(
                `Copilot RTL: Auto-check failed — ${message}. You can still enable manually from the Command Palette.`
            );
        }
    }

    // ── Status bar toggle button ─────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'copilot-rtl.toggle';
    statusBarItem.tooltip = 'Click to toggle Copilot RTL on/off';
    statusBarItem.show();

    async function updateStatusBar(): Promise<void> {
        const hp = getWorkbenchHtmlPath();
        if (!hp) {
            statusBarItem.text = '$(globe) RTL ❌';
            return;
        }
        try {
            const content = await fsp.readFile(hp, 'utf8');
            if (isPatched(content)) {
                statusBarItem.text = '$(globe) RTL ✅';
                statusBarItem.backgroundColor = undefined;
            } else {
                statusBarItem.text = '$(globe) RTL ❌';
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
        } catch {
            statusBarItem.text = '$(globe) RTL ⚠️';
        }
    }

    // Set initial status
    updateStatusBar();

    // ── Toggle command ──────────────────────────────────────────────────────
    const toggleCmd = vscode.commands.registerCommand('copilot-rtl.toggle', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            const currentlyEnabled = isPatched(content);

            if (currentlyEnabled) {
                // Disable
                const result = await disablePatch(htmlPath);
                if (result.success) {
                    await context.globalState.update(STATE_KEY_DISABLED, true);
                    await updateStatusBar();
                    vscode.window.showInformationMessage('Copilot RTL disabled.');
                } else {
                    vscode.window.showErrorMessage(
                        `Copilot RTL: Failed to disable — ${result.error}. Try running VS Code as Administrator.`
                    );
                }
            } else {
                // Enable
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
                const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
                if (result.success) {
                    await context.globalState.update(STATE_KEY_DISABLED, false);
                    await updateStatusBar();
                    vscode.window.showInformationMessage('Copilot RTL enabled.');
                } else {
                    vscode.window.showErrorMessage(
                        `Copilot RTL: Failed to enable — ${result.error}. Try running VS Code as Administrator.`
                    );
                }
            }
        } catch {
            vscode.window.showErrorMessage('Copilot RTL: Could not read workbench HTML file.');
        }
    });

    // ── Enable command ──────────────────────────────────────────────────────
    const enableCmd = vscode.commands.registerCommand('copilot-rtl.enable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
        const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
        if (result.success) {
            await context.globalState.update(STATE_KEY_DISABLED, false);
            await updateStatusBar();
            vscode.window.showInformationMessage('Copilot RTL enabled.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to enable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    // ── Disable command ─────────────────────────────────────────────────────
    const disableCmd = vscode.commands.registerCommand('copilot-rtl.disable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const result = await disablePatch(htmlPath);
        if (result.success) {
            await context.globalState.update(STATE_KEY_DISABLED, true);
            await updateStatusBar();
            vscode.window.showInformationMessage('Copilot RTL disabled.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to disable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    // ── Status command ──────────────────────────────────────────────────────
    const statusCmd = vscode.commands.registerCommand('copilot-rtl.status', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showWarningMessage(
                `Copilot RTL: Could not find workbench HTML file. appRoot=${vscode.env.appRoot}`
            );
            return;
        }

        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            const enabled = isPatched(content);
            vscode.window.showInformationMessage(
                `Copilot RTL is currently ${enabled ? '✅ ENABLED' : '❌ DISABLED'}.`
            );
        } catch {
            vscode.window.showErrorMessage('Copilot RTL: Could not read workbench HTML file.');
        }
    });

    // Re-apply patch automatically when the user changes font settings
    const configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (!e.affectsConfiguration('copilotRtl')) { return; }
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) { return; }
        try {
            const content = await fsp.readFile(htmlPath, 'utf8');
            if (!isPatched(content)) { return; }  // only update if already enabled
        } catch { return; }
        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign } = getSettings();
        const result = await enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, textAlign);
        if (result.success) {
            await updateStatusBar();
            await promptReload('Copilot RTL: Settings updated. Reload to apply.');
        }
    });

    context.subscriptions.push(toggleCmd, enableCmd, disableCmd, statusCmd, statusBarItem, configListener);
}

export function deactivate(): void { }
