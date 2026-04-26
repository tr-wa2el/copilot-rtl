/**
 * RTL Engine — Cursor Engine (Layer 4) v4
 *
 * Hybrid cursor positioning:
 * - RTL lines: Monaco getScrolledVisiblePosition() → verified correct from debug data
 * - LTR lines: DOM Range API on actual view-line → Monaco API broken for LTR in RTL container
 *
 * Detection: data-rtl-dir attribute OR visualPos.left >= editorWidth (Monaco LTR-broken signal)
 */

import { CSS_CLASS, ELEMENT_ID } from './constants';
import { isMainCodeEditor } from './utils';
import { findEditorForDom, getNonCodeEditors } from './monaco-bridge';

let _ghostCursor: HTMLElement | null = null;
const _attachedEditors = new WeakSet<any>();
let _pointerdownAttached = false;


export interface CursorConfig { fontSize: string; lineHeight: string; }

// ── Ghost Cursor Element ──────────────────────────────────────────────

function getOrCreateGhostCursor(): HTMLElement {
    if (!_ghostCursor) {
        _ghostCursor = document.getElementById(ELEMENT_ID.GHOST_CURSOR) as HTMLElement;
        if (!_ghostCursor) {
            _ghostCursor = document.createElement('div');
            _ghostCursor.id = ELEMENT_ID.GHOST_CURSOR;
            document.body.appendChild(_ghostCursor);
            _ghostCursor.style.display = 'none';
        }
    }
    return _ghostCursor;
}

export function hideGhostCursor(): void {
    if (_ghostCursor) _ghostCursor.style.display = 'none';
}

function showGhostCursor(
    monacoEditor: Element,
    left: number, top: number, height: number
): void {
    const gc = getOrCreateGhostCursor();
    gc.style.display = 'block';
    gc.style.left   = left   + 'px';
    gc.style.top    = top    + 'px';
    gc.style.height = height + 'px';
    gc.classList.remove('blink');
    void gc.offsetWidth;
    gc.classList.add('blink');
    if (!monacoEditor.classList.contains(CSS_CLASS.GHOST_ATTACHED)) {
        monacoEditor.classList.add(CSS_CLASS.GHOST_ATTACHED);
    }
}

// ── LTR cursor: DOM Range on actual view-line ─────────────────────────
// Monaco's getScrolledVisiblePosition returns editorWidth (stuck) for LTR
// in RTL containers. DOM Range gives actual rendered glyph position.

function getLtrCursorFromDom(
    viewLineEl: HTMLElement,
    column: number,
    monacoEditor: Element,
    config: CursorConfig
): boolean {
    // Walk text nodes, sum character counts to reach Monaco column
    const walker = document.createTreeWalker(viewLineEl, NodeFilter.SHOW_TEXT, null);
    let remaining = column - 1; // convert to 0-based offset
    let targetNode: Text | null = null;
    let targetOffset = 0;

    while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        const len = t.nodeValue!.length;
        if (remaining <= len) {
            targetNode = t;
            targetOffset = remaining;
            break;
        }
        remaining -= len;
    }

    if (!targetNode) {
        // Column beyond text — use end of last text node
        const walker2 = document.createTreeWalker(viewLineEl, NodeFilter.SHOW_TEXT, null);
        let last: Text | null = null;
        while (walker2.nextNode()) last = walker2.currentNode as Text;
        if (!last) return false;
        targetNode = last;
        targetOffset = last.nodeValue!.length;
    }

    try {
        const range = document.createRange();
        range.setStart(targetNode, targetOffset);
        range.setEnd(targetNode, targetOffset);
        const rect = range.getBoundingClientRect();
        if (!rect.top && !rect.height && !rect.left) return false;

        const height = visualLineHeight(viewLineEl) || parseFloat(config.fontSize) * parseFloat(config.lineHeight) || 20;
        showGhostCursor(monacoEditor, rect.left, rect.top, height);
        return true;
    } catch {
        return false;
    }
}

function visualLineHeight(lineEl: HTMLElement): number {
    return lineEl.getBoundingClientRect().height || 0;
}

// ── Main ghost cursor update ──────────────────────────────────────────

function updateGhostFromEditorApi(
    editorInstance: any,
    monacoEditor: Element,
    config: CursorConfig
): void {
    try {
        if (!monacoEditor.isConnected || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) {
            hideGhostCursor(); return;
        }

        const pos = editorInstance.getPosition?.();
        if (!pos) { hideGhostCursor(); return; }

        const visualPos = editorInstance.getScrolledVisiblePosition?.(pos);
        if (!visualPos || visualPos.top < 0) { hideGhostCursor(); return; }

        const editorRect = (monacoEditor as HTMLElement).getBoundingClientRect();
        const ghostH = visualPos.height
            || parseFloat(config.fontSize) * parseFloat(config.lineHeight) || 20;

        // Find the view-line matching this vertical offset
        const viewLines = monacoEditor.querySelectorAll('.view-line');
        let lineEl: HTMLElement | null = null;
        for (let i = 0; i < viewLines.length; i++) {
            const vl = viewLines[i] as HTMLElement;
            const vlTop = vl.getBoundingClientRect().top - editorRect.top;
            if (Math.abs(vlTop - visualPos.top) < 4) { lineEl = vl; break; }
        }

        // ── POSITIONING STRATEGY: based on line direction ────────────────
        // RTL lines → Monaco's getScrolledVisiblePosition (verified accurate)
        // LTR lines → DOM Range (Monaco returns wrong value in RTL container)
        const isLtrLine = lineEl?.getAttribute('data-rtl-dir') === 'ltr'
            || visualPos.left >= editorRect.width - 2;

        if (isLtrLine) {
            if (lineEl && getLtrCursorFromDom(lineEl, pos.column, monacoEditor, config)) {
                return;
            }
            showGhostCursor(monacoEditor, editorRect.left, editorRect.top + visualPos.top, ghostH);
            return;
        }

        // RTL strategy
        showGhostCursor(
            monacoEditor,
            editorRect.left + visualPos.left,
            editorRect.top  + visualPos.top,
            ghostH
        );
    } catch {
        hideGhostCursor();
    }
}

// ── Cursor Layers (no-op — driven by onDidChangeCursorPosition) ────────
export function observeCursorLayers(_config: CursorConfig): void {}

// ── Helpers for click-to-column mapping ───────────────────────────────

/**
 * Map a click point to Monaco column using browser's CSS-aware caret API.
 * document.caretRangeFromPoint respects our direction:rtl CSS, unlike
 * Monaco's getTargetAtClientPoint which uses its internal LTR hit-testing.
 */
function getColumnFromCaretPoint(viewLineEl: HTMLElement, cx: number, cy: number): number | null {
    // Use browser's built-in caret-from-point (Chrome/Edge: caretRangeFromPoint)
    const range = (document as any).caretRangeFromPoint?.(cx, cy) as Range | undefined;
    if (!range) return null;
    if (!viewLineEl.contains(range.startContainer)) return null;

    // Count characters before this text node to get Monaco column (1-based)
    const walker = document.createTreeWalker(viewLineEl, NodeFilter.SHOW_TEXT, null);
    let col = 1;
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node === range.startContainer) {
            return col + range.startOffset;
        }
        col += node.nodeValue!.length;
    }
    return null;
}

/**
 * Get Monaco lineNumber for a view-line element using its top style offset
 * matched against Monaco's scroll position.
 */
function getLineNumberFromViewLine(
    viewLineEl: HTMLElement,
    editorInstance: any
): number | null {
    const topStr = viewLineEl.style.top;
    const topPx  = topStr ? parseFloat(topStr) : NaN;
    if (isNaN(topPx)) return null;

    const scrollTop: number = editorInstance.getScrollTop?.() ?? 0;

    // Use the view-line's actual rendered height (reliable, avoids getOption complexity)
    const lineHeight = viewLineEl.getBoundingClientRect().height || 20;

    // Find the top offset of the first visible view-line to account for editor padding
    const allViewLines = viewLineEl.parentElement?.querySelectorAll('.view-line');
    let minTop = topPx;
    if (allViewLines) {
        for (let i = 0; i < allViewLines.length; i++) {
            const t = parseFloat((allViewLines[i] as HTMLElement).style.top || '0');
            if (!isNaN(t) && t < minTop) minTop = t;
        }
    }

    // lineNumber = floor((topPx - minTop + scrollTop) / lineHeight) + 1
    // minTop accounts for editor's top padding (e.g. 12px)
    const lineNumber = Math.floor((topPx - minTop + scrollTop) / lineHeight) + 1;
    return lineNumber >= 1 ? lineNumber : null;
}

// ── Click Interceptor ──────────────────────────────────────────────────
export function attachClickInterceptor(): void {
    if (_pointerdownAttached) return;
    _pointerdownAttached = true;

    // Use mousedown (not pointerdown) — PointerEvent.detail is always 0 in Electron.
    // MouseEvent.detail correctly counts: 1=single, 2=double, 3=triple.
    document.addEventListener('mousedown', (e: MouseEvent) => {
        const target = e.target as Element;
        const monacoEditor = target?.closest?.('.monaco-editor');
        if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;
        if (isMainCodeEditor(monacoEditor)) return;

        // Only intercept clicks on RTL (Arabic) view-lines
        const viewLine = target.closest?.('.view-line') as HTMLElement | null;
        const isRtlLine = viewLine
            ? viewLine.getAttribute('data-rtl-dir') !== 'ltr'
            : false;

        if (!viewLine || !isRtlLine) return;

        // Triple-click: let Monaco handle (line selection)
        if (e.detail > 2) return;

        const editorRecords = getNonCodeEditors();
        const editorInstance = findEditorForDom(monacoEditor, editorRecords);
        if (!editorInstance) return;

        const column     = getColumnFromCaretPoint(viewLine, e.clientX, e.clientY);
        const lineNumber = getLineNumberFromViewLine(viewLine, editorInstance);

        if (column === null || lineNumber === null) return;

        e.preventDefault();
        e.stopPropagation();

        if (e.detail === 2) {
            // Double-click: Arabic-aware word selection
            setTimeout(() => {
                const model = editorInstance.getModel?.();
                if (!model) { editorInstance.setPosition({ lineNumber, column }); return; }

                const lineText: string = model.getLineContent(lineNumber);
                const WORD_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\w]/;

                const clickedChar = lineText[column - 1] ?? '';
                if (!WORD_RE.test(clickedChar)) {
                    editorInstance.setPosition({ lineNumber, column });
                    editorInstance.focus();
                    return;
                }

                let startCol = column;
                while (startCol > 1 && WORD_RE.test(lineText[startCol - 2] ?? '')) { startCol--; }
                let endCol = column;
                while (endCol <= lineText.length && WORD_RE.test(lineText[endCol - 1] ?? '')) { endCol++; }

                editorInstance.setSelection({
                    startLineNumber: lineNumber, startColumn: startCol,
                    endLineNumber:   lineNumber, endColumn:   endCol,
                });
                editorInstance.focus();
            }, 0);
        } else {
            // Single click: RTL-correct cursor positioning
            setTimeout(() => {
                editorInstance.setPosition({ lineNumber, column });
                editorInstance.focus();
            }, 0);
        }
    }, true);

    // Block dblclick event — Monaco also listens on this for word selection
    document.addEventListener('dblclick', (e: MouseEvent) => {
        const target = e.target as Element;
        const monacoEditor = target?.closest?.('.monaco-editor');
        if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;
        if (isMainCodeEditor(monacoEditor)) return;
        const vl = target.closest?.('.view-line') as HTMLElement | null;
        if (!vl || vl.getAttribute('data-rtl-dir') === 'ltr') return;
        e.preventDefault();
        e.stopPropagation();
    }, true);

}







// ── Editor Lifecycle ───────────────────────────────────────────────────
export function attachClickHandler(editorInstance: any, config?: CursorConfig): void {
    if (!editorInstance || _attachedEditors.has(editorInstance)) return;
    _attachedEditors.add(editorInstance);
    try {
        const domNode = editorInstance.getDomNode?.() as HTMLElement | null;
        const monacoEditor = domNode?.closest('.monaco-editor') ?? domNode;
        if (!monacoEditor) return;
        const cfg = config ?? { fontSize: '14', lineHeight: '1.8' };
        editorInstance.onDidChangeCursorPosition?.(() => {
            // Defer by one tick so MutationObserver can set data-rtl-dir first
            // (MutationObserver runs as microtask, setTimeout runs after)
            setTimeout(() => {
                // Only update if THIS editor is focused (prevents editor2 override)
                if (!editorInstance.hasTextFocus?.()) return;
                updateGhostFromEditorApi(editorInstance, monacoEditor, cfg);
            }, 0);
        });
        editorInstance.onDidFocusEditorText?.(() => {
            setTimeout(() => {
                if (monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL))
                    updateGhostFromEditorApi(editorInstance, monacoEditor, cfg);
            }, 0);
        });
        editorInstance.onDidBlurEditorText?.(() => hideGhostCursor());
    } catch {}
    attachClickInterceptor();
}

export function destroyCursorEngine(): void {
    _ghostCursor?.parentNode?.removeChild(_ghostCursor);
    _ghostCursor = null;
}
