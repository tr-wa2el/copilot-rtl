import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const MARKER_START = '<!-- COPILOT-RTL-PATCH-START -->';
const MARKER_END = '<!-- COPILOT-RTL-PATCH-END -->';
const PATCH_JS_NAME = 'copilot-rtl-patch.js';
const AGENT_PATCH_JS_NAME = 'copilot-rtl-agent-patch.js';

/** The JS that gets written to a standalone file (no inline script — avoids CSP). */
function buildScriptFileContent(fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number): string {
    return `(function () {
    'use strict';

    const RTL_FONT_FAMILY  = ${JSON.stringify(fontFamily + ', sans-serif')};
    const RTL_FONT_SIZE    = ${JSON.stringify(fontSize + 'px')};
    const RTL_LINE_HEIGHT  = ${JSON.stringify(String(lineHeight))};
    const RTL_FONT_NAME    = ${JSON.stringify(fontFamily)};
    const LTR_FONT_FAMILY  = ${JSON.stringify(ltrFontFamily)};
    const LTR_FONT_SIZE    = ${JSON.stringify(ltrFontSize > 0 ? ltrFontSize + 'px' : '')};
    const LTR_LINE_HEIGHT  = ${JSON.stringify(ltrLineHeight > 0 ? String(ltrLineHeight) : '')};

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

    // ── Antigravity chat support (React + Tailwind + Lexical) ──────────
    function scanAntigravity() {
        // Bot response paragraphs, list items, headings
        var selectors = [
            '.leading-relaxed.select-text p',
            '.leading-relaxed.select-text li',
            '.leading-relaxed.select-text h1',
            '.leading-relaxed.select-text h2',
            '.leading-relaxed.select-text h3',
            '.leading-relaxed.select-text h4',
        ];
        document.querySelectorAll(selectors.join(',')).forEach(function (el) {
            if (el.tagName === 'PRE' || el.tagName === 'CODE' || el.closest('pre') || el.closest('code')) { return; }
            applyDirection(el);
        });

        // Bot response container direction
        document.querySelectorAll('.leading-relaxed.select-text').forEach(function (el) {
            if (isArabicOrMixed(el.textContent || '')) {
                el.style.direction = 'rtl';
            }
        });

        // User messages (skip code/pre elements that also use whitespace-pre-wrap)
        document.querySelectorAll('.whitespace-pre-wrap').forEach(function (el) {
            if (el.tagName === 'CODE' || el.tagName === 'PRE' || el.closest('pre') || el.closest('code')) { return; }
            applyDirection(el);
        });

        // Table cells inside responses
        document.querySelectorAll('.leading-relaxed.select-text th, .leading-relaxed.select-text td').forEach(function (el) {
            applyDirection(el);
        });
        document.querySelectorAll('.leading-relaxed.select-text table').forEach(function (el) {
            if (isArabicOrMixed(el.textContent || '')) {
                el.style.direction = 'rtl';
            } else {
                el.style.direction = 'ltr';
            }
        });

        // Lexical input box (Antigravity uses contenteditable instead of Monaco)
        document.querySelectorAll('[data-lexical-editor="true"]').forEach(function (editor) {
            var text = editor.textContent || '';
            var arabic = isArabicOrMixed(text);
            
            // Remove hardcoded direction/textAlign from the parent container
            editor.style.direction = '';
            editor.style.textAlign = '';
            
            if (arabic) {
                editor.style.fontFamily = RTL_FONT_FAMILY;
                editor.style.fontSize = RTL_FONT_SIZE;
            } else {
                editor.style.fontFamily = '';
                editor.style.fontSize = '';
            }

            // Apply direction per paragraph so each has its own alignment
            var children = editor.children;
            for (var i = 0; i < children.length; i++) {
                applyDirection(children[i]);
            }
        });
    }

    function scanAll() {
        scanAllMarkdown();
        scanAntigravity();
    }

    function observeMarkdown() {
        var _mdScanTimeout = null;
        function scheduleMdScan() {
            if (_mdScanTimeout) return;
            _mdScanTimeout = setTimeout(function () {
                _mdScanTimeout = null;
                scanAll();
            }, 200);
        }

        var observer = new MutationObserver(scheduleMdScan);

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        scanAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMarkdown);
    } else {
        observeMarkdown();
    }

    // Watch Lexical input changes directly (Antigravity)
    document.addEventListener('input', function (e) {
        var target = e.target;
        var editor = target && target.closest ? target.closest('[data-lexical-editor="true"]') : null;
        if (editor) {
            var text = editor.textContent || '';
            var arabic = ARABIC_RE.test(text);
            
            editor.style.direction = '';
            editor.style.textAlign = '';
            
            if (arabic) {
                editor.style.fontFamily = RTL_FONT_FAMILY;
                editor.style.fontSize = RTL_FONT_SIZE;
            } else {
                editor.style.fontFamily = '';
                editor.style.fontSize = '';
            }

            var children = editor.children;
            for (var i = 0; i < children.length; i++) {
                applyDirection(children[i]);
            }
        }
    }, true);

    // ── CSS Injection for Monaco & Chat ─────────────────────────────────
    function injectStyles() {
        if (document.getElementById('copilot-rtl-styles')) return;
        var style = document.createElement('style');
        style.id = 'copilot-rtl-styles';
        // Use string concatenation to avoid TS template literal confusion with generated code variables
        var css = '';
        // Do NOT set direction:rtl on the .monaco-editor container itself!
        // Monaco uses a ~16M px wide .lines-content element for virtual scrolling.
        // Setting direction:rtl on an ancestor causes absolutely-positioned children
        // (like .view-lines) to snap to the RIGHT edge of that huge container,
        // pushing text completely off-screen.  Direction is applied only to the
        // specific text-rendering children below.
        // Do NOT override font-family/font-size on .view-lines — Monaco uses its own font
        // metrics (measured at startup) to calculate cursor pixel position. Changing the
        // CSS font without updating Monaco's measurement cache causes the cursor to drift
        // away from the actual text insertion point.
        css += '.copilot-rtl-v2 .view-lines { unicode-bidi: plaintext !important; }';
        css += '.copilot-rtl-v2 .view-line { direction: rtl !important; text-align: right !important; }';
        // Apply direction to the native input surface so the browser positions its own
        // cursor (caret) correctly inside the EditContext / contenteditable area.
        css += '.copilot-rtl-v2 .native-edit-context { direction: rtl !important; unicode-bidi: plaintext !important; }';
        css += '.copilot-rtl-v2 .inputarea { direction: rtl !important; text-align: right !important; }';
        style.textContent = css;
        document.head.appendChild(style);
    }
    injectStyles();

    // ── Monaco-based chat input RTL support ──────────────────────────────
    var CODE_EDITOR_ANCESTORS = [
        '.editor-group-container',
        '.editor-instance',
        '.monaco-workbench .part.editor',
    ];

    function isMainCodeEditor(monacoEl) {
        if (!monacoEl || !monacoEl.closest) { return false; }
        for (var i = 0; i < CODE_EDITOR_ANCESTORS.length; i++) {
            if (monacoEl.closest(CODE_EDITOR_ANCESTORS[i])) return true;
        }
        return false;
    }

    function processNonCodeMonacos() {
        var allMonacos = document.querySelectorAll('.monaco-editor');
        for (var m = 0; m < allMonacos.length; m++) {
            var editor = allMonacos[m];
            if (isMainCodeEditor(editor)) continue;

            var text = editor.textContent || '';

            // Monaco removes then re-adds .view-line elements on every keystroke.
            // During the brief DOM gap the textContent reads as empty/non-Arabic,
            // which would remove the RTL class and cause a visible per-char flicker.
            // Guard: if the editor is already in RTL mode and the text is momentarily
            // empty, keep the current state instead of toggling.
            if (!text.trim() && editor.classList.contains('copilot-rtl-v2')) {
                continue;
            }

            var arabic = isArabicOrMixed(text);

            // Toggle the class on the editor container
            if (arabic) {
                editor.classList.add('copilot-rtl-v2');
            } else {
                editor.classList.remove('copilot-rtl-v2');
            }
        }
    }

    // Run non-code Monaco scan inside the main scan cycle
    var origScanAll = scanAll;
    scanAll = function () {
        origScanAll();
        processNonCodeMonacos();
    };

    // Use a lightweight event listener for typing
    document.addEventListener('input', function (e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            // If the editor is already in RTL mode, do not re-evaluate on every
            // keystroke — the mutation-observer debounce will handle steady-state
            // checks. This prevents removing-then-re-adding the class mid-render
            // (the other half of the per-char flicker).
            if (!monacoParent.classList.contains('copilot-rtl-v2')) {
                processNonCodeMonacos();
            }
        }
    }, true);

    // ── Periodic fallback scan ──
    var _scanCount = 0;
    var _scanTimer = setInterval(function () {
        scanAll();
        if (++_scanCount >= 30) clearInterval(_scanTimer);
    }, 2000);

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
            
            editor.style.direction = '';
            editor.style.textAlign = '';
            
            if (arabic) {
                editor.style.fontFamily = RTL_FONT_FAMILY;
                editor.style.fontSize = RTL_FONT_SIZE;
            } else {
                editor.style.fontFamily = '';
                editor.style.fontSize = '';
            }

            var children = editor.children;
            for (var i = 0; i < children.length; i++) {
                var childText = children[i].textContent || '';
                var childArabic = isArabic(childText);
                children[i].style.direction = childArabic ? 'rtl' : 'ltr';
                children[i].style.textAlign = childArabic ? 'right' : 'left';
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
            if (target && target.closest && target.closest('[data-lexical-editor="true"]')) {
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

function enablePatch(htmlPath: string, fontFamily: string, fontSize: number, lineHeight: number, ltrFontFamily: string, ltrFontSize: number, ltrLineHeight: number): { success: boolean; error?: string } {
    try {
        const htmlDir = path.dirname(htmlPath);
        const jsPath = path.join(htmlDir, PATCH_JS_NAME);

        // Always write/overwrite the JS file (updates font settings)
        fs.writeFileSync(jsPath, buildScriptFileContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight), 'utf8');

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
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight } = getSettings();
                const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);
                if (result.success) {
                    promptReload('Copilot RTL installed and enabled automatically. Reload to apply.');
                }
            } else {
                // Already patched — always rewrite the JS file so extension updates take effect
                // without requiring the user to disable then re-enable the extension manually.
                const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight } = getSettings();
                try {
                    const htmlDir = path.dirname(htmlPath);
                    const jsPath = path.join(htmlDir, PATCH_JS_NAME);
                    fs.writeFileSync(jsPath, buildScriptFileContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight), 'utf8');
                } catch {
                    // ignore — user can still use the manual enable command
                }

                // Also make sure agent panel is patched and up to date
                const agentPath = getAgentHtmlPath();
                if (agentPath) {
                    try {
                        const agentContent = fs.readFileSync(agentPath, 'utf8');
                        if (!isPatched(agentContent)) {
                            enableAgentPatch(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);
                            promptReload('Copilot RTL: Antigravity chat panel patched. Reload to apply.');
                        } else {
                            // Rewrite agent JS too
                            const agentDir = path.dirname(agentPath);
                            const agentJsPath = path.join(agentDir, AGENT_PATCH_JS_NAME);
                            fs.writeFileSync(agentJsPath, buildAgentScriptContent(fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight), 'utf8');
                        }
                    } catch {
                        // ignore
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

        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);
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
        const { fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight } = getSettings();
        const result = enablePatch(htmlPath, fontFamily, fontSize, lineHeight, ltrFontFamily, ltrFontSize, ltrLineHeight);
        if (result.success) {
            await promptReload('Copilot RTL: Settings updated. Reload to apply.');
        }
    });

    context.subscriptions.push(enableCmd, disableCmd, statusCmd, configListener);
}

export function deactivate(): void { }
