import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';
const AGENT_PATCH_JS_NAME = 'copilot-rtl-agent-patch.js';

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

    // All known selectors for the Copilot/chat markdown container across VS Code versions
    const MD_CONTAINER_SELECTORS = [
        '.rendered-markdown',
        '.chat-response-rendered-markdown',
        '.monaco-chat-answer .markdown-body',
        '.markdown-body',
        '.chat-message-text',
        '.chat-response-list-item .rendered-markdown',
        '.interactive-response .rendered-markdown',
        '.copilot-chat-response .rendered-markdown',
        '.chat-tree-item-contents .rendered-markdown',
        '.chat-list-item-layout .rendered-markdown',
    ];

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
        // Iterate direct children directly (avoids :scope / > selector issues)
        var children = root.children;
        for (var i = 0; i < children.length; i++) {
            applyDirection(children[i]);
        }
        // Also handle list items anywhere inside the container
        var items = root.querySelectorAll('li');
        for (var j = 0; j < items.length; j++) {
            applyDirection(items[j]);
        }
        // Handle table cells — apply RTL per-cell so mixed tables work
        var cells = root.querySelectorAll('th, td');
        for (var t = 0; t < cells.length; t++) {
            applyDirection(cells[t]);
        }
        // If the table itself contains Arabic, set its overall direction
        var tables = root.querySelectorAll('table');
        for (var tb = 0; tb < tables.length; tb++) {
            if (isArabicOrMixed(tables[tb].textContent || '')) {
                tables[tb].style.direction = 'rtl';
            } else {
                tables[tb].style.direction = 'ltr';
            }
        }
    }

    function scanAllMarkdown() {
        MD_CONTAINER_SELECTORS.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(processMarkdown);
        });
    }

    function observeMarkdown() {
        var _mdScanTimeout = null;
        function scheduleMdScan() {
            if (_mdScanTimeout) return;
            _mdScanTimeout = setTimeout(function () {
                _mdScanTimeout = null;
                scanAllMarkdown();
            }, 200);
        }

        var observer = new MutationObserver(scheduleMdScan);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        scanAllMarkdown();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMarkdown);
    } else {
        observeMarkdown();
    }

    // ── Input box direction ──────────────────────────────────────────────────
    var watchInputEditors = null;

    if (AUTO_INPUT_DIR) {
        function applyInputDirection(editorEl, observer) {
            if (observer) { observer.disconnect(); }

            var linesContainer = editorEl.querySelector('.view-lines');
            var text = linesContainer ? (linesContainer.textContent || '') : '';
            var isArabic = ARABIC_RE.test(text);
            var dir = isArabic ? 'rtl' : 'ltr';

            // 1. The Monaco editor wrapper
            editorEl.style.direction = dir;
            editorEl.style.textAlign = isArabic ? 'right' : '';
            editorEl.style.fontFamily = isArabic ? RTL_FONT_FAMILY : LTR_FONT_FAMILY;

            // 2. The actual textarea (.inputarea) — controls cursor position & IME
            var inputArea = editorEl.querySelector('.inputarea');
            if (inputArea) {
                inputArea.style.direction = dir;
            }

            // 3. The .view-lines container
            if (linesContainer && linesContainer.style) {
                linesContainer.style.direction = dir;
                if (isArabic) {
                    linesContainer.style.fontFamily = RTL_FONT_FAMILY;
                    linesContainer.style.fontSize = RTL_FONT_SIZE;
                }
            }

            // 4. Each .view-line — Monaco sets dir="ltr" on them, override it
            var viewLines = editorEl.querySelectorAll('.view-line');
            for (var k = 0; k < viewLines.length; k++) {
                if (viewLines[k].getAttribute('dir') !== dir) {
                    viewLines[k].setAttribute('dir', dir);
                }
                viewLines[k].style.direction = dir;
                viewLines[k].style.textAlign = isArabic ? 'right' : '';
            }

            if (observer && linesContainer) {
                observer.observe(linesContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['dir'] });
            }
        }

        function attachEditor(editor) {
            if (editor.__rtlWatched) { return; }
            editor.__rtlWatched = true;
            
            var _inputDirTimeout = null;
            var lineObserver = new MutationObserver(function () {
                if (_inputDirTimeout) clearTimeout(_inputDirTimeout);
                _inputDirTimeout = setTimeout(function () {
                    _inputDirTimeout = null;
                    applyInputDirection(editor, lineObserver);
                }, 200);
            });
            
            applyInputDirection(editor, lineObserver);

            var inputArea = editor.querySelector('.inputarea');
            if (inputArea) {
                inputArea.addEventListener('input', function () {
                    applyInputDirection(editor, lineObserver);
                });
                inputArea.addEventListener('compositionend', function () {
                    applyInputDirection(editor, lineObserver);
                });
            }
        }

        watchInputEditors = function () {
            // 1. Specific selectors covering different VS Code / Copilot chat versions
            var selectors = [
                '.interactive-input-editor .monaco-editor',
                '.chat-input-part .monaco-editor',
                '.aichat-input .monaco-editor',
                '.chat-editor-container .monaco-editor',
                '.chat-input-editor .monaco-editor',
                '.interactive-session-input .monaco-editor',
                '.copilot-chat .monaco-editor',
                '.inline-chat .monaco-editor',
                '[class*="chat-input"] .monaco-editor',
                '[class*="copilot"] .monaco-editor',
                '[class*="chat-session"] .monaco-editor',
                '[class*="ced-chat"] .monaco-editor',
            ];
            document.querySelectorAll(selectors.join(',')).forEach(attachEditor);

            // 2. Broader fallback: any Monaco editor in a panel/sidebar/auxiliary-bar
            //    that looks like a small input (≤5 view-lines = chat input, not a code editor)
            var panelEditors = document.querySelectorAll(
                '.panel .monaco-editor, .sidebar .monaco-editor, ' +
                '.auxiliary-bar .monaco-editor, .part.panel .monaco-editor'
            );
            panelEditors.forEach(function (editor) {
                if (editor.__rtlWatched) { return; }
                var viewLines = editor.querySelectorAll('.view-line');
                if (viewLines.length <= 5) {
                    attachEditor(editor);
                }
            });
        };

        var watchTimeout = null;
        var inputObserver = new MutationObserver(function () {
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(watchInputEditors, 500);
        });
        inputObserver.observe(document.body, { childList: true, subtree: true });
        watchInputEditors();
    }

    // ── Periodic fallback scan (handles lazy-loaded panels & class name changes) ──
    var _scanCount = 0;
    var _scanTimer = setInterval(function () {
        scanAllMarkdown();
        if (AUTO_INPUT_DIR && watchInputEditors) { watchInputEditors(); }
        if (++_scanCount >= 20) { clearInterval(_scanTimer); }
    }, 3000);

}());
`;
}

/** Build the JS for Antigravity's agent chat panel (React + Tailwind + Lexical). */
function buildAgentScriptContent(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number): string {
    return `(function () {
    'use strict';

    const RTL_FONT_FAMILY  = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE    = ${JSON.stringify(fontSize + 'px')};
    const RTL_LINE_HEIGHT  = ${JSON.stringify(String(lineHeight))};
    const RTL_FONT_NAME    = ${JSON.stringify(fontFamily)};
    const LTR_FONT_FAMILY  = ${JSON.stringify(ltrFontFamily)};
    const LTR_FONT_SIZE    = ${JSON.stringify(ltrFontSize > 0 ? ltrFontSize + 'px' : '')};
    const LTR_LINE_HEIGHT  = ${JSON.stringify(ltrLineHeight > 0 ? String(ltrLineHeight) : '')};

    // Arabic Unicode blocks
    var ARABIC_RE = /[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]/;

    function isArabic(text) {
        return ARABIC_RE.test(text);
    }

    function applyRtlStyle(el, arabic) {
        if (arabic) {
            el.style.direction = 'rtl';
            el.style.textAlign = 'right';
            el.style.fontFamily = RTL_FONT_FAMILY;
            el.style.fontSize = RTL_FONT_SIZE;
            el.style.lineHeight = RTL_LINE_HEIGHT;
        } else {
            el.style.direction = 'ltr';
            el.style.textAlign = '';
            el.style.fontFamily = LTR_FONT_FAMILY;
            el.style.fontSize = LTR_FONT_SIZE;
            el.style.lineHeight = LTR_LINE_HEIGHT;
        }
    }

    // ── Chat messages (response + user messages) ─────────────────────────
    // Antigravity renders chat text inside these containers:
    //   - .leading-relaxed.select-text (bot responses with markdown)
    //   - .whitespace-pre-wrap (user messages and inline text)
    function processMessages() {
        // Bot response paragraphs
        document.querySelectorAll('.leading-relaxed.select-text p, .leading-relaxed.select-text li').forEach(function (el) {
            if (el.tagName === 'PRE' || el.tagName === 'CODE' || el.closest('pre') || el.closest('code')) { return; }
            applyRtlStyle(el, isArabic(el.textContent || ''));
        });

        // Bot response container direction (for list markers, etc.)
        document.querySelectorAll('.leading-relaxed.select-text').forEach(function (el) {
            if (isArabic(el.textContent || '')) {
                el.style.direction = 'rtl';
            }
        });

        // User messages (the whitespace-pre-wrap inside the chat bubble)
        document.querySelectorAll('.bg-gray-500\\\\/10 .whitespace-pre-wrap').forEach(function (el) {
            applyRtlStyle(el, isArabic(el.textContent || ''));
        });

        // Headings inside responses
        document.querySelectorAll('.leading-relaxed.select-text h1, .leading-relaxed.select-text h2, .leading-relaxed.select-text h3, .leading-relaxed.select-text h4').forEach(function (el) {
            applyRtlStyle(el, isArabic(el.textContent || ''));
        });

        // Table cells — apply RTL per-cell so mixed tables work
        document.querySelectorAll('.leading-relaxed.select-text th, .leading-relaxed.select-text td').forEach(function (el) {
            applyRtlStyle(el, isArabic(el.textContent || ''));
        });
        // Table overall direction
        document.querySelectorAll('.leading-relaxed.select-text table').forEach(function (el) {
            if (isArabic(el.textContent || '')) {
                el.style.direction = 'rtl';
            } else {
                el.style.direction = 'ltr';
            }
        });
    }

    // ── Input box (Lexical contenteditable) ──────────────────────────────
    function processInput() {
        var editors = document.querySelectorAll('[data-lexical-editor="true"]');
        editors.forEach(function (editor) {
            var text = editor.textContent || '';
            var arabic = isArabic(text);
            editor.style.direction = arabic ? 'rtl' : 'ltr';
            editor.style.textAlign = arabic ? 'right' : 'left';
            if (arabic) {
                editor.style.fontFamily = RTL_FONT_FAMILY;
                editor.style.fontSize = RTL_FONT_SIZE;
            } else {
                editor.style.fontFamily = '';
                editor.style.fontSize = '';
            }
        });
    }

    // ── Debounced observer ───────────────────────────────────────────────
    var _scanTimeout = null;
    function scheduleScan() {
        if (_scanTimeout) { return; }
        _scanTimeout = setTimeout(function () {
            _scanTimeout = null;
            processMessages();
            processInput();
        }, 200);
    }

    function startObserver() {
        var observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        processMessages();
        processInput();
    }

    // Also watch input changes directly
    function watchInputEvents() {
        document.addEventListener('input', function (e) {
            var target = e.target;
            if (target && target.getAttribute && target.getAttribute('data-lexical-editor') === 'true') {
                processInput();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            startObserver();
            watchInputEvents();
        });
    } else {
        startObserver();
        watchInputEvents();
    }

    // Periodic fallback for lazy-loaded content
    var _count = 0;
    var _timer = setInterval(function () {
        processMessages();
        processInput();
        if (++_count >= 20) { clearInterval(_timer); }
    }, 3000);

}());
`;
}

/** The HTML snippet injected into workbench.html — just a src="" script tag, no inline code. */
function buildPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

function buildAgentPatchContent(version: number): string {
    return `${MARKER_START}\n<script src="${AGENT_PATCH_JS_NAME}?v=${version}"></script>\n${MARKER_END}`;
}

/** Find Antigravity's agent chat panel HTML (workbench-jetski-agent.html). */
function getAgentHtmlPath(): string | undefined {
    try {
        const appRoot = vscode.env.appRoot;
        const execDir = path.dirname(process.execPath);

        const candidates: string[] = [
            path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
            path.join(execDir, '..', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench-jetski-agent.html'),
        ];

        for (const candidate of candidates) {
            const normalized = path.normalize(candidate);
            if (fs.existsSync(normalized)) {
                return normalized;
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

        // Also patch the Antigravity agent panel if it exists
        enableAgentPatch(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

function enableAgentPatch(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number): { success: boolean; error?: string } {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return { success: false, error: 'Agent HTML not found' }; }

    try {
        const htmlDir = path.dirname(agentPath);
        const jsPath = path.join(htmlDir, AGENT_PATCH_JS_NAME);

        // Write the agent-specific JS
        fs.writeFileSync(jsPath, buildAgentScriptContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight), 'utf8');

        let content = fs.readFileSync(agentPath, 'utf8');
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
                fs.writeFileSync(backupPath, content, 'utf8');
            }
        }

        if (content.includes('</html>')) {
            content = content.replace('</html>', `${patch}\n</html>`);
        } else {
            content += '\n' + patch;
        }

        fs.writeFileSync(agentPath, content, 'utf8');
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

        // Also clean up the agent panel
        disableAgentPatch();

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

function disableAgentPatch(): void {
    const agentPath = getAgentHtmlPath();
    if (!agentPath) { return; }

    try {
        let content = fs.readFileSync(agentPath, 'utf8');
        if (isPatched(content)) {
            const regex = new RegExp(
                `\\n?${escapeForRegex(MARKER_START)}[\\s\\S]*?${escapeForRegex(MARKER_END)}\\n?`,
                'g'
            );
            content = content.replace(regex, '');
            fs.writeFileSync(agentPath, content, 'utf8');
        }
        const jsPath = path.join(path.dirname(agentPath), AGENT_PATCH_JS_NAME);
        if (fs.existsSync(jsPath)) {
            fs.unlinkSync(jsPath);
        }
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

export function activate(context: vscode.ExtensionContext): void {
    // ── Auto-enable on first activation ──────────────────────────────────────
    const htmlPath = getWorkbenchHtmlPath();
    if (htmlPath) {
        try {
            const content = fs.readFileSync(htmlPath, 'utf8');
            if (!isPatched(content)) {
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection } = getSettings();
                const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight, autoInputDirection);
                if (result.success) {
                    promptReload('Copilot RTL installed and enabled automatically. Reload to apply.');
                }
            } else {
                // Main workbench already patched — make sure agent panel is also patched
                const agentPath = getAgentHtmlPath();
                if (agentPath) {
                    const agentContent = fs.readFileSync(agentPath, 'utf8');
                    if (!isPatched(agentContent)) {
                        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight } = getSettings();
                        enableAgentPatch(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);
                        promptReload('Copilot RTL: Antigravity chat panel patched. Reload to apply.');
                    }
                }
            }
        } catch {
            // If we can't read/write, the user can still use the manual command
        }
    }

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
            await promptReload('Copilot RTL: Settings updated. Reload to apply.');
        }
    });

    context.subscriptions.push(enableCmd, disableCmd, statusCmd, configListener);
}

export function deactivate(): void {}
