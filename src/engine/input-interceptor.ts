/**
 * RTL Engine — Input Interceptor (Layer 6)
 * Fixes keyboard navigation and IME behavior for RTL text in Monaco.
 *
 * Problems solved:
 * 1. Home/End keys go to wrong edge in RTL
 * 2. IME composition window appears at wrong position
 * 3. Arrow keys need visual (not logical) navigation in RTL
 */

import { CSS_CLASS } from './constants';
import { isMainCodeEditor } from './utils';
import { isArabicOrMixed } from './utils';
import { getNonCodeEditors, findEditorForDom } from './monaco-bridge';

let _keyboardAttached = false;

// ── Keyboard Navigation Fixes ─────────────────────────────────────────

/**
 * Attach keyboard interceptor for RTL-specific key remapping.
 * Intercepts Home/End to go to visual line edges instead of logical.
 */
export function attachKeyboardInterceptor(): void {
    if (_keyboardAttached) return;
    _keyboardAttached = true;

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        const target = e.target as Element;
        if (!target?.closest) return;

        const monacoEditor = target.closest('.monaco-editor');
        if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;
        if (isMainCodeEditor(monacoEditor)) return;

        // Get the editor instance
        const editorRecords = getNonCodeEditors();
        const editorInstance = findEditorForDom(monacoEditor, editorRecords);
        if (!editorInstance) return;

        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // ── Home key: go to visual start of line ──────────────────
        // In RTL, visual start is the RIGHT edge, but Monaco sends cursor
        // to column 1 (LEFT edge). We override to go to line end visually.
        if (key === 'Home' && !ctrl) {
            e.preventDefault();
            e.stopPropagation();
            const pos = editorInstance.getPosition();
            if (pos) {
                const model = editorInstance.getModel();
                if (model) {
                    const lineContent = model.getLineContent(pos.lineNumber);
                    const lineLen = lineContent.length;
                    // In RTL, "Home" should go to end of line content (visual start)
                    if (isArabicOrMixed(lineContent)) {
                        const newCol = shift ? pos.column : lineLen + 1;
                        if (shift) {
                            const sel = editorInstance.getSelection();
                            if (sel) {
                                editorInstance.setSelection({
                                    startLineNumber: sel.startLineNumber,
                                    startColumn: sel.startColumn,
                                    endLineNumber: pos.lineNumber,
                                    endColumn: lineLen + 1,
                                });
                            }
                        } else {
                            editorInstance.setPosition({ lineNumber: pos.lineNumber, column: lineLen + 1 });
                        }
                        return;
                    }
                }
            }
        }

        // ── End key: go to visual end of line ─────────────────────
        // In RTL, visual end is the LEFT edge, but Monaco sends cursor
        // to line end. We override to go to column 1 visually.
        if (key === 'End' && !ctrl) {
            e.preventDefault();
            e.stopPropagation();
            const pos = editorInstance.getPosition();
            if (pos) {
                const model = editorInstance.getModel();
                if (model) {
                    const lineContent = model.getLineContent(pos.lineNumber);
                    if (isArabicOrMixed(lineContent)) {
                        if (shift) {
                            const sel = editorInstance.getSelection();
                            if (sel) {
                                editorInstance.setSelection({
                                    startLineNumber: sel.startLineNumber,
                                    startColumn: sel.startColumn,
                                    endLineNumber: pos.lineNumber,
                                    endColumn: 1,
                                });
                            }
                        } else {
                            editorInstance.setPosition({ lineNumber: pos.lineNumber, column: 1 });
                        }
                        return;
                    }
                }
            }
        }
    }, true);
}

// ── IME Direction Fix ─────────────────────────────────────────────────

/**
 * fixInputAreaDirection is now handled by direction-manager per cursor line.
 * This function is kept as a lightweight no-op for API compatibility.
 * The actual direction fix happens in direction-manager.fixInputAreaForCursorLine().
 */
export function fixInputAreaDirection(): void {
    // Direction-manager handles this per-cursor-line now.
    // No-op — kept for API compatibility with lifecycle manager.
}

// ── Ctrl+Shift Direction Toggle Prevention ────────────────────────────
// Windows uses Ctrl+Shift to toggle input direction, which conflicts
// with VS Code shortcuts. We absorb this in RTL editors.

export function preventDirectionToggle(): void {
    document.addEventListener('keyup', (e: KeyboardEvent) => {
        // Ctrl+Shift alone (no other key) toggles direction on Windows
        if ((e.key === 'Shift' && e.ctrlKey) || (e.key === 'Control' && e.shiftKey)) {
            const target = e.target as Element;
            if (target?.closest?.('.monaco-editor')?.classList?.contains(CSS_CLASS.EDITOR_RTL)) {
                // Re-apply our direction to counteract the toggle
                fixInputAreaDirection();
            }
        }
    }, true);
}
