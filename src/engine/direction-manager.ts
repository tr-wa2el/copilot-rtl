/**
 * RTL Engine — Direction Manager (Layer 2) — ROOT FIX
 * 
 * CRITICAL CHANGE: Per-LINE direction instead of per-EDITOR.
 * 
 * Old approach (BROKEN):
 *   - Detect Arabic anywhere in editor → mark ENTIRE editor RTL
 *   - CSS rule makes ALL .view-line elements RTL
 *   - English lines after Arabic lines become RTL → WRONG
 *   
 * New approach (ROOT FIX):
 *   - Editor gets class only to signal "has some Arabic" (for font CSS)
 *   - Each .view-line is individually scanned and gets inline direction
 *   - English-only lines stay LTR with native Monaco cursor
 *   - inputarea direction follows the CURRENT cursor line, not the editor
 *   - NO updateOptions({ fontFamily }) — CSS-only font to preserve word wrap
 */

import { CSS_CLASS } from './constants';
import { isArabicOrMixed, isMainCodeEditor } from './utils';
import { getNonCodeEditors, findEditorForDom } from './monaco-bridge';
import { observeCursorLayers, attachClickHandler, type CursorConfig } from './cursor-engine';

/** True while we are inside a double-rAF triggered by an 'input' event. */
let _monacoTyping = false;

/** Attribute name for marking per-line direction state. */
const LINE_DIR_ATTR = 'data-rtl-dir';

/**
 * Scan each .view-line individually and apply direction per-line.
 * This is the ROOT FIX — no more blanket editor-level direction.
 */
function applyPerLineDirection(monacoEditor: Element): void {
    const linesContent = monacoEditor.querySelector('.view-lines');
    if (!linesContent) return;

    const viewLines = linesContent.querySelectorAll('.view-line');
    let hasAnyArabic = false;

    for (let i = 0; i < viewLines.length; i++) {
        const vl = viewLines[i] as HTMLElement;
        const text = vl.textContent || '';
        const lineIsArabic = isArabicOrMixed(text);

        if (lineIsArabic) {
            hasAnyArabic = true;
            if (vl.getAttribute(LINE_DIR_ATTR) !== 'rtl') {
                vl.style.direction = 'rtl';
                vl.style.textAlign = 'right';
                vl.style.unicodeBidi = 'plaintext';
                vl.setAttribute(LINE_DIR_ATTR, 'rtl');
            }
        } else {
            // English/empty line → explicitly LTR (override any inherited RTL)
            if (vl.getAttribute(LINE_DIR_ATTR) !== 'ltr') {
                vl.style.direction = 'ltr';
                vl.style.textAlign = 'left';
                vl.style.unicodeBidi = 'normal';
                vl.setAttribute(LINE_DIR_ATTR, 'ltr');
            }
        }
    }

    // Editor-level class: only for "has some Arabic" (used for font CSS, inputarea)
    if (hasAnyArabic) {
        monacoEditor.classList.add(CSS_CLASS.EDITOR_RTL);
    } else {
        monacoEditor.classList.remove(CSS_CLASS.EDITOR_RTL);
    }
}

/**
 * Fix inputarea direction based on the CURRENT cursor line.
 * The inputarea determines how the browser handles keyboard input —
 * it must match the direction of the line being edited, NOT the whole editor.
 */
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

        if (lineIsArabic) {
            inputArea.style.direction = 'rtl';
            inputArea.style.unicodeBidi = 'plaintext';
        } else {
            inputArea.style.direction = 'ltr';
            inputArea.style.unicodeBidi = 'normal';
        }
    } catch {}
}

/**
 * Process all non-code Monaco editors with per-line direction.
 */
export function processNonCodeMonacos(cursorConfig: CursorConfig): void {
    const editorRecords = getNonCodeEditors();

    // Attach cursor layer observers
    observeCursorLayers(cursorConfig);

    const allMonacos = document.querySelectorAll('.monaco-editor');
    for (let m = 0; m < allMonacos.length; m++) {
        const editor = allMonacos[m] as HTMLElement;
        if (isMainCodeEditor(editor)) continue;

        // Per-line direction scanning — the ROOT FIX
        applyPerLineDirection(editor);

        // Fix inputarea direction for current cursor line
        const editorInstance = findEditorForDom(editor, editorRecords);
        fixInputAreaForCursorLine(editor, editorInstance);

        // Attach click handler if editor has any Arabic
        if (editor.classList.contains(CSS_CLASS.EDITOR_RTL) && editorInstance) {
            attachClickHandler(editorInstance);

            // Listen for cursor position changes to update inputarea direction
            if (!(editorInstance as any).__rtlCursorListener) {
                try {
                    (editorInstance as any).__rtlCursorListener = true;
                    editorInstance.onDidChangeCursorPosition?.(() => {
                        fixInputAreaForCursorLine(editor, editorInstance);
                    });
                } catch {}
            }
        }
    }
}

/**
 * Set up input event listeners for Monaco chat inputs.
 * Double rAF: Monaco needs 2 frames to update .view-line elements after input.
 */
export function setupInputListeners(cursorConfig: CursorConfig): void {
    // Typing detection
    document.addEventListener('input', (e: Event) => {
        const target = e.target as Element;
        if (!target?.closest) return;
        const monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            _monacoTyping = true;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    _monacoTyping = false;
                    processNonCodeMonacos(cursorConfig);
                });
            });
        }
    }, true);

    // Focus detection
    document.addEventListener('focusin', (e: Event) => {
        const target = e.target as Element;
        if (!target?.closest) return;
        const monacoParent = target.closest('.monaco-editor');
        if (monacoParent && !isMainCodeEditor(monacoParent)) {
            processNonCodeMonacos(cursorConfig);
        }
    }, true);
}
