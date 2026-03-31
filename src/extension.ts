import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';

/**
 * The CSS/JS patch injected into workbench.desktop.main.html
 * Based on https://github.com/NabiKAZ/vscode-copilot-rtl
 */
const PATCH_CONTENT = `${MARKER_START}
<script>
/**
 * This script modifies the styling of various elements in a web page to support RTL (Right-to-Left) text direction
 * It applies RTL direction, Vazirmatn font family, and specific font sizes to interactive elements
 * Code blocks and result editors remain LTR (Left-to-Right) for proper code display
 * https://github.com/NabiKAZ/vscode-copilot-rtl
 */
(function () {
    'use strict';

    const css = \`
/* COPILOT RTL PATCH */
.rendered-markdown > *:not(div) {
  direction: rtl !important;
  font-family: vazirmatn !important;
  font-size: 13px !important;
}\`;

    function injectStyle() {
        if (document.getElementById('copilot-rtl-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'copilot-rtl-style';
        style.textContent = css;
        (document.head || document.querySelector('head')).appendChild(style);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyle);
    } else {
        injectStyle();
    }
})();
</script>
${MARKER_END}`;

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

function enablePatch(htmlPath: string): { success: boolean; error?: string } {
    try {
        let content = fs.readFileSync(htmlPath, 'utf8');

        if (isPatched(content)) {
            return { success: true };
        }

        // Create a backup before modifying
        const backupPath = `${htmlPath}.bak-copilot-rtl`;
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, content, 'utf8');
        }

        // Inject the patch before </html>
        if (content.includes('</html>')) {
            content = content.replace('</html>', `${PATCH_CONTENT}\n</html>`);
        } else {
            content += '\n' + PATCH_CONTENT;
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

        const result = enablePatch(htmlPath);
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

    context.subscriptions.push(enableCmd, disableCmd, statusCmd);
}

export function deactivate(): void {}
