import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';

/** The JS that gets written to a standalone file (no inline script — avoids CSP). */
function buildScriptFileContent(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, autoInputDirection: boolean): string {
    return `(function () {
    'use strict';

    const RTL_FONT_FAMILY  = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE    = ${JSON.stringify(fontSize + 'px')};
    const RTL_LINE_HEIGHT  = ${JSON.stringify(String(lineHeight))};
    const RTL_FONT_NAME    = ${JSON.stringify(fontFamily)};
    const LTR_FONT_FAMILY  = ${JSON.stringify(ltrFontFamily)};
    const LTR_FONT_SIZE    = ${JSON.stringify(ltrFontSize > 0 ? ltrFontSize + 'px' : '')};
    const LTR_LINE_HEIGHT  = ${JSON.stringify(ltrLineHeight > 0 ? String(ltrLineHeight) : '')};
    const AUTO_INPUT_DIR   = ${autoInputDirection ? 'true' : 'false'};

    // Warn in DevTools console if the requested font is not available
    document.fonts.ready.then(function () {
        if (!document.fonts.check('16px ' + RTL_FONT_NAME)) {
            console.warn(
                '[Copilot RTL] Font "' + RTL_FONT_NAME + '" was not found. ' +
                'Arabic text will fall back to sans-serif. ' +
                'Install the font or change the Copilot RTL font setting.'
            );
        }
    });

    // Arabic Unicode blocks: Arabic, Arabic Supplement, Arabic Presentation Forms A & B
    const ARABIC_RE = /[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;

    function isArabicOrMixed(text) {
        return ARABIC_RE.test(text);
    }

    function applyDirection(el) {
        if (el.tagName === 'PRE' || el.tagName === 'CODE') {
            el.style.direction = 'ltr';
            el.style.fontFamily = '';
            return;
        }
        if (isArabicOrMixed(el.textContent || '')) {
            el.style.direction = 'rtl';
            el.style.fontFamily = RTL_FONT_FAMILY;
            el.style.fontSize = RTL_FONT_SIZE;
            el.style.lineHeight = RTL_LINE_HEIGHT;
            el.style.textAlign = 'right';
        } else {
            el.style.direction = 'ltr';
            el.style.fontFamily = LTR_FONT_FAMILY;
            el.style.fontSize = LTR_FONT_SIZE;
            el.style.lineHeight = LTR_LINE_HEIGHT;
            el.style.textAlign = '';
        }
    }

    function processMarkdown(root) {
        const children = root.querySelectorAll(
            '.rendered-markdown > *:not(div), .rendered-markdown li'
        );
        children.forEach(applyDirection);
    }

    function observeMarkdown() {
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) { return; }
                    const container = node.closest
                        ? node.closest('.rendered-markdown')
                        : null;
                    if (container) {
                        processMarkdown(container);
                    } else {
                        node.querySelectorAll && node
                            .querySelectorAll('.rendered-markdown')
                            .forEach(processMarkdown);
                    }
                });
                if (mutation.type === 'characterData') {
                    const el = mutation.target.parentElement;
                    if (el) { applyDirection(el); }
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        document.querySelectorAll('.rendered-markdown').forEach(processMarkdown);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMarkdown);
    } else {
        observeMarkdown();
    }

    // ── Input box direction ──────────────────────────────────────────────────
    if (AUTO_INPUT_DIR) {
        function applyInputDirection(editorEl) {
            const lines = editorEl.querySelector('.view-lines');
            const text = lines ? (lines.textContent || '') : '';
            const isArabic = ARABIC_RE.test(text);
            editorEl.style.direction = isArabic ? 'rtl' : 'ltr';
            editorEl.style.textAlign = isArabic ? 'right' : '';
            if (isArabic) {
                editorEl.style.fontFamily = RTL_FONT_FAMILY;
            } else {
                editorEl.style.fontFamily = LTR_FONT_FAMILY;
            }
        }

        function watchInputEditors() {
            // Selectors covering different VS Code / Copilot chat versions
            const selectors = [
                '.interactive-input-editor .monaco-editor',
                '.chat-input-part .monaco-editor',
                '.aichat-input .monaco-editor',
            ];
            const editors = document.querySelectorAll(selectors.join(','));
            editors.forEach(function (editor) {
                if (editor.__rtlWatched) { return; }
                editor.__rtlWatched = true;
                applyInputDirection(editor);
                const inputArea = editor.querySelector('.inputarea');
                if (inputArea) {
                    inputArea.addEventListener('input', function () {
                        applyInputDirection(editor);
                    });
                    inputArea.addEventListener('compositionend', function () {
                        applyInputDirection(editor);
                    });
                }
            });
        }

        const inputObserver = new MutationObserver(function () {
            watchInputEditors();
        });
        inputObserver.observe(document.body, { childList: true, subtree: true });
        watchInputEditors();
    }
`;
}

/** The HTML snippet injected into workbench.html — just a src="" script tag, no inline code. */
function buildPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

function getWorkbenchHtmlPath(): string | undefined {
    try {
        // vscode.env.appRoot reliably points to the VS Code "resources/app" directory
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        // Each entry is [baseDir, fileName] pair — ordered most-likely-first
        const candidates: [string, string][] = [
            // VS Code 1.90+ (electron-browser layout, just "workbench.html")
            [path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            // Older layouts that used workbench.desktop.main.html
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.esm.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.desktop.esm.html'],
            [path.join(appRoot, 'out', 'vs', 'workbench'), 'workbench.html'],
            // Fallbacks via process.execPath
            [path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            [path.join(execDir, 'resources', 'app', 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
            [path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'), 'workbench.html'],
            [path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'workbench'), 'workbench.desktop.main.html'],
        ];

        for (const [dir, fileName] of candidates) {
            const candidate = path.normalize(path.join(dir, fileName));
            if (fs.existsSync(candidate)) {
                return candidate;
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

function getSettings(): { fontFamily: string; fontSize: number; lineHeight: number; ltrFontFamily: string; ltrFontSize: number; ltrLineHeight: number; autoInputDirection: boolean } {
    const cfg = vscode.workspace.getConfiguration('copilotRtl');
    return {
        fontFamily: cfg.get<string>('fontFamily', 'vazirmatn'),
        fontSize: cfg.get<number>('fontSize', 13),
        lineHeight: cfg.get<number>('lineHeight', 1.8),
        ltrFontFamily: cfg.get<string>('ltrFontFamily', ''),
        ltrFontSize: cfg.get<number>('ltrFontSize', 0),
        ltrLineHeight: cfg.get<number>('ltrLineHeight', 0),
        autoInputDirection: cfg.get<boolean>('autoInputDirection', true),
    };
}

function enablePatch(htmlPath: string, fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number, autoInputDirection: boolean): { success: boolean; error?: string } {
    try {
        const htmlDir = path.dirname(htmlPath);
        const jsPath = path.join(htmlDir, PATCH_JS_NAME);

        // Always write/overwrite the JS file (updates font settings)
        fs.writeFileSync(jsPath, buildScriptFileContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection), 'utf8');

        let content = fs.readFileSync(htmlPath, 'utf8');
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
                fs.writeFileSync(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        fs.writeFileSync(htmlPath, content, 'utf8');
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

function disablePatch(htmlPath: string): { success: boolean; error?: string } {
    try {
        let content = fs.readFileSync(htmlPath, 'utf8');

        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            fs.writeFileSync(htmlPath, content, 'utf8');
        }

        // Remove the JS file if it exists
        const jsPath = path.join(path.dirname(htmlPath), PATCH_JS_NAME);
        if (fs.existsSync(jsPath)) {
            fs.unlinkSync(jsPath);
        }

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

async function promptReload(message: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(message, 'Reload Now');
    if (action === 'Reload Now') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const enableCmd = vscode.commands.registerCommand('copilot-rtl.enable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection);
        if (result.success) {
            await promptReload('Copilot RTL enabled. Reload VS Code to apply changes.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to enable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    const disableCmd = vscode.commands.registerCommand('copilot-rtl.disable', async () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showErrorMessage(
                'Copilot RTL: Could not locate the VS Code workbench HTML file.'
            );
            return;
        }

        const result = disablePatch(htmlPath);
        if (result.success) {
            await promptReload('Copilot RTL disabled. Reload VS Code to apply changes.');
        } else {
            vscode.window.showErrorMessage(
                `Copilot RTL: Failed to disable — ${result.error}. Try running VS Code as Administrator.`
            );
        }
    });

    const statusCmd = vscode.commands.registerCommand('copilot-rtl.status', () => {
        const htmlPath = getWorkbenchHtmlPath();
        if (!htmlPath) {
            vscode.window.showWarningMessage(
                `Copilot RTL: Could not find workbench HTML file. appRoot=${vscode.env.appRoot}`
            );
            return;
        }

        try {
            const content = fs.readFileSync(htmlPath, 'utf8');
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
        const content = fs.readFileSync(htmlPath, 'utf8');
        if (!isPatched(content)) { return; }  // only update if already enabled
        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection);
        if (result.success) {
            await promptReload('Copilot RTL: Font settings updated. Reload VS Code to apply.');
        }
    });

    context.subscriptions.push(enableCmd, disableCmd, statusCmd, configListener);
}

export function deactivate(): void {}
