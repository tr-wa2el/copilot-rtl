/**
 * RTL Engine — Direction Manager (Layer 2) — ZERO FLICKER v3
 * 
 * STRATEGY: CSS blanket + synchronous attribute tagging
 * 
 * 1. CSS applies Arabic font to ALL view-lines inside .copilot-rtl-v2
 *    EXCEPT those with [data-rtl-dir="ltr"] (via :not() selector).
 *    → Arabic lines get font instantly from CSS. Survives DOM replacement.
 * 
 * 2. A synchronous MutationObserver on .view-lines tags every new/modified
 *    view-line with data-rtl-dir="rtl" or "ltr" BEFORE the browser paints.
 *    → English lines get [data-rtl-dir="ltr"] → CSS excludes them → no flash.
 * 
 * 3. No inline font styles. CSS handles everything via attribute selectors.
 *    JS only sets the data-rtl-dir attribute.
 * 
 * Result: Arabic lines never flash default font. English lines never flash
 * Arabic font. True zero flicker.
 */

import { CSS_CLASS } from './constants';
import { isArabicOrMixed, isMainCodeEditor } from './utils';
import { getNonCodeEditors, findEditorForDom } from './monaco-bridge';
import { applyRtlFont, type FontConfig } from './font-metrics';
import { observeCursorLayers, attachClickHandler, type CursorConfig } from './cursor-engine';

let _monacoTyping = false;
const LINE_DIR_ATTR = 'data-rtl-dir';

// Track which .view-lines containers have an observer attached
const _viewLineObservers = new WeakMap<Element, MutationObserver>();

// ── Stable Parent ─────────────────────────────────────────────────────

function getStableParent(monacoEditor: Element): Element {
    const parent = monacoEditor.parentElement;
    if (!parent) return monacoEditor;

    const knownSelectors = [
        '.interactive-input-editor',
        '.chat-editor-input', 
        '.inline-chat-editor',
        '.scm-editor',
    ];
    for (const sel of knownSelectors) {
        const container = monacoEditor.closest(sel);
        if (container) return container;
    }

    return parent;
}

// ── Per-line direction tagging ────────────────────────────────────────

/**
 * Tag a single view-line with data-rtl-dir="rtl" or "ltr".
 * CSS uses this attribute to decide font. No inline styles needed.
 * This is called SYNCHRONOUSLY from MutationObserver (before paint).
 */
function tagViewLineDirection(vl: HTMLElement): void {
    const text = vl.textContent || '';
    const lineIsArabic = isArabicOrMixed(text);
    const dir = lineIsArabic ? 'rtl' : 'ltr';
    if (vl.getAttribute(LINE_DIR_ATTR) !== dir) {
        vl.setAttribute(LINE_DIR_ATTR, dir);
    }
}

/**
 * Synchronous MutationObserver on .view-lines.
 * Tags new/modified view-lines BEFORE the browser paints.
 * This is what prevents flicker — the data attribute is set
 * before the first visible frame of the new element.
 */
function setupViewLineObserver(monacoEditor: Element): void {
    const viewLinesContainer = monacoEditor.querySelector('.view-lines');
    if (!viewLinesContainer) return;
    if (_viewLineObservers.has(viewLinesContainer)) return;

    const observer = new MutationObserver((mutations) => {
        // SYNCHRONOUS: MutationObserver callbacks run as microtasks,
        // which execute BEFORE the browser's rendering pipeline (style → layout → paint).
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                // New view-line elements added by Monaco
                for (let i = 0; i < mutation.addedNodes.length; i++) {
                    const node = mutation.addedNodes[i] as HTMLElement;
                    if (node.nodeType !== 1) continue;
                    if (node.classList?.contains('view-line')) {
                        tagViewLineDirection(node);
                    }
                    // Also check nested view-lines (rare but safe)
                    if (node.querySelectorAll) {
                        const inner = node.querySelectorAll('.view-line');
                        for (let j = 0; j < inner.length; j++) {
                            tagViewLineDirection(inner[j] as HTMLElement);
                        }
                    }
                }
            }
            // Text content changed — re-evaluate direction
            if (mutation.type === 'characterData' || mutation.type === 'childList') {
                const target = mutation.target as Element;
                const viewLine = target.closest?.('.view-line') as HTMLElement;
                if (viewLine) {
                    tagViewLineDirection(viewLine);
                }
            }
        }
    });

    observer.observe(viewLinesContainer, {
        childList: true,
        subtree: true,
        characterData: true,
    });
    _viewLineObservers.set(viewLinesContainer, observer);
}

/**
 * Initial scan: tag all existing view-lines and mark stable parent.
 * Also sets up the MutationObserver for future changes.
 */
function applyPerLineDirection(monacoEditor: Element): void {
    const linesContent = monacoEditor.querySelector('.view-lines');
    if (!linesContent) return;

    // Set up synchronous observer for future DOM changes
    setupViewLineObserver(monacoEditor);

    const viewLines = linesContent.querySelectorAll('.view-line');
    let hasAnyArabic = false;

    for (let i = 0; i < viewLines.length; i++) {
        const vl = viewLines[i] as HTMLElement;
        tagViewLineDirection(vl);
        if (isArabicOrMixed(vl.textContent || '')) {
            hasAnyArabic = true;
        }
    }

    // Mark stable parent once (sticky — never removed during operation)
    if (hasAnyArabic) {
        const stableParent = getStableParent(monacoEditor);
        if (!stableParent.classList.contains(CSS_CLASS.EDITOR_RTL)) {
            stableParent.classList.add(CSS_CLASS.EDITOR_RTL);
        }
        if (!monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) {
            monacoEditor.classList.add(CSS_CLASS.EDITOR_RTL);
        }
    }
}

// ── Input area direction fix ──────────────────────────────────────────

function fixInputAreaForCursorLine(monacoEditor: Element, editorInstance: any): void {
    if (!editorInstance) return;

    const inputArea = monacoEditor.querySelector('.inputarea, .native-edit-context') as HTMLElement;
    if (!inputArea) return;

    try {
        const pos = editorInstance.getPosition?.();
        if (!pos) return;
        const model = editorInstance.getModel?.();
        if (!model) return;

        const lineContent = model.getLineContent(pos.lineNumber);
        const lineIsArabic = isArabicOrMixed(lineContent);

        inputArea.style.direction = lineIsArabic ? 'rtl' : 'ltr';
        inputArea.style.unicodeBidi = lineIsArabic ? 'plaintext' : 'normal';
    } catch {}
}

// ── Process all non-code Monaco editors ───────────────────────────────

export function processNonCodeMonacos(fontConfig: FontConfig, cursorConfig: CursorConfig): void {
    const editorRecords = getNonCodeEditors();
    observeCursorLayers(cursorConfig);

    const allMonacos = document.querySelectorAll('.monaco-editor');
    for (let m = 0; m < allMonacos.length; m++) {
        const editor = allMonacos[m] as HTMLElement;
        if (isMainCodeEditor(editor)) continue;

        applyPerLineDirection(editor);

        const editorInstance = findEditorForDom(editor, editorRecords);
        fixInputAreaForCursorLine(editor, editorInstance);

        // applyRtlFont is a no-op (Monaco API inaccessible — window.require=null)
        if (editorInstance) {
            applyRtlFont(editorInstance, fontConfig);
            attachClickHandler(editorInstance);
        }
    }
}

// ── Input event listeners ─────────────────────────────────────────────

export function setupInputListeners(fontConfig: FontConfig, cursorConfig: CursorConfig): void {
    document.addEventListener('input', (e: Event) => {
        const target = e.target as Element;
        if (!target?.closest) return;
        const monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            _monacoTyping = true;
            requestAnimationFrame(() => {
                _monacoTyping = false;
                processNonCodeMonacos(fontConfig, cursorConfig);
            });
        }
    }, true);

    document.addEventListener('focusin', (e: Event) => {
        const target = e.target as Element;
        if (!target?.closest) return;
        const monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            processNonCodeMonacos(fontConfig, cursorConfig);
        }
    }, true);
}

// ── Cleanup ───────────────────────────────────────────────────────────

export function clearStickyState(): void {
    document.querySelectorAll(`.${CSS_CLASS.EDITOR_RTL}`).forEach(el => {
        el.classList.remove(CSS_CLASS.EDITOR_RTL);
    });
}
