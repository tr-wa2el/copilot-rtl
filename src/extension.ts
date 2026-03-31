import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';

function buildPatchContent(fontFamily: string, fontSize: number): string {
    return `${MARKER_START}
<script>
(function () {
    'use strict';

    const RTL_FONT_FAMILY = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE   = ${JSON.stringify(fontSize + 'px')};

    // Arabic Unicode blocks: Arabic, Arabic Supplement, Arabic Presentation Forms A & B
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

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
            el.style.textAlign = 'right';
        } else {
            el.style.direction = 'ltr';
            el.style.fontFamily = '';
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
})();
</script>
${MARKER_END}`;
}

function getWorkbenchHtmlPath(): string | undefined {
    try {
        const execPath = process.execPath;
        const baseDir = path.dirname(execPath);

        const candidates = [
            path.join(baseDir, 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
            path.join(baseDir, '..', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
        ];

        for (const candidate of candidates) {
            const normalized = path.normalize(candidate);
            if (fs.existsSync(normalized)) {
                return normalized;
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

function getSettings(): { fontFamily: string; fontSize: number } {
    const cfg = vscode.workspace.getConfiguration('copilotRtl');
    return {
        fontFamily: cfg.get<string>('fontFamily', 'vazirmatn'),
        fontSize: cfg.get<number>('fontSize', 13),
    };
}

function enablePatch(htmlPath: string, fontFamily: string, fontSize: number): { success: boolean; error?: string } {
    try {
        let content = fs.readFileSync(htmlPath, 'utf8');
        const patch = buildPatchContent(fontFamily, fontSize);

        // Remove existing patch first (handles settings update)
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

        if (!isPatched(content)) {
            return { success: true };
        }

        const regex = new RegExp(
            `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
            'g'
        );
        content = content.replace(regex, '');

        fs.writeFileSync(htmlPath, content, 'utf8');
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

        const { fontFamily, fontSize } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize);
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
            vscode.window.showWarningMessage('Copilot RTL: Could not find workbench HTML file.');
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
        const { fontFamily, fontSize } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize);
        if (result.success) {
            await promptReload('Copilot RTL: Font settings updated. Reload VS Code to apply.');
        }
    });

    context.subscriptions.push(enableCmd, disableCmd, statusCmd, configListener);
}

export function deactivate(): void {}
