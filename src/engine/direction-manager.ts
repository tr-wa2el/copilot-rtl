/**
 * RTL Engine — Direction Manager (Layer 2)
 * Manages RTL/LTR state for Monaco editor instances in chat inputs.
 */

import { CSS_CLASS } from './constants';
import { isArabicOrMixed, isMainCodeEditor } from './utils';
import { getNonCodeEditors, findEditorForDom } from './monaco-bridge';
import { applyRtlFont, restoreFont, type FontConfig } from './font-metrics';
import { observeCursorLayers, attachClickHandler, type CursorConfig } from './cursor-engine';

/** True while we are inside a double-rAF triggered by an 'input' event. */
let _monacoTyping = false;

/**
 * Process all non-code Monaco editors: detect Arabic, apply/remove RTL mode.
 */
export function processNonCodeMonacos(fontConfig: FontConfig, cursorConfig: CursorConfig): void {
    const editorRecords = getNonCodeEditors();

    // Attach cursor layer observers
    observeCursorLayers(cursorConfig);

    const allMonacos = document.querySelectorAll('.monaco-editor');
    for (let m = 0; m < allMonacos.length; m++) {
        const editor = allMonacos[m] as HTMLElement;
        if (isMainCodeEditor(editor)) continue;

        const editorInstance = findEditorForDom(editor, editorRecords);

        // Read ONLY from .view-lines so we don't pick up placeholder text
        const viewLines = editor.querySelector('.view-lines');
        const text = viewLines ? (viewLines.textContent || '') : (editor.textContent || '');

        // Empty guard: only keep RTL class if we're mid-render (typing)
        if (!text.trim() && editor.classList.contains(CSS_CLASS.EDITOR_RTL) && _monacoTyping) {
            continue;
        }

        const arabic = isArabicOrMixed(text);

        if (arabic) {
            editor.classList.add(CSS_CLASS.EDITOR_RTL);
            applyRtlFont(editorInstance, fontConfig);
            attachClickHandler(editorInstance);
        } else {
            editor.classList.remove(CSS_CLASS.EDITOR_RTL);
            restoreFont(editorInstance);
        }
    }
}

/**
 * Set up input event listeners for Monaco chat inputs.
 * Double rAF: Monaco needs 2 frames to update .view-line elements after input.
 */
export function setupInputListeners(fontConfig: FontConfig, cursorConfig: CursorConfig): void {
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
                    processNonCodeMonacos(fontConfig, cursorConfig);
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
            processNonCodeMonacos(fontConfig, cursorConfig);
        }
    }, true);
}
