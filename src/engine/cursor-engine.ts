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

function showGhostCursor(monacoEditor: Element, left: number, top: number, height: number): void {
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
    column: number,          // Monaco 1-based column
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

        // Detect LTR:
        // Primary:  data-rtl-dir="ltr" set by direction-manager MutationObserver
        // Fallback: visualPos.left == editorWidth → Monaco's broken LTR signal
        const isLtr = lineEl?.getAttribute('data-rtl-dir') === 'ltr'
            || visualPos.left >= editorRect.width - 2;

        if (isLtr) {
            // LTR strategy: DOM Range on the actual rendered view-line
            // Monaco's visualPos.left is stuck at editorWidth for LTR in RTL container.
            if (lineEl && getLtrCursorFromDom(lineEl, pos.column, monacoEditor, config)) {
                return;
            }
            // Fallback: place at editor left edge for this row
            showGhostCursor(monacoEditor, editorRect.left, editorRect.top + visualPos.top, ghostH);
            return;
        }

        // RTL strategy: Monaco's getScrolledVisiblePosition is correct for RTL
        // (verified from debug data: values decrease correctly as Arabic chars typed)
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

// ── Click Interceptor ──────────────────────────────────────────────────
export function attachClickInterceptor(): void {
    if (_pointerdownAttached) return;
    _pointerdownAttached = true;
    document.addEventListener('pointerdown', (e: PointerEvent) => {
        const target = e.target as Element;
        const monacoEditor = target?.closest?.('.monaco-editor');
        if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;
        if (isMainCodeEditor(monacoEditor)) return;
        const editorRecords = getNonCodeEditors();
        const editorInstance = findEditorForDom(monacoEditor, editorRecords);
        if (!editorInstance) return;
        const viewLines = monacoEditor.querySelector('.view-lines');
        if (!viewLines?.contains(target)) return;
        if (typeof editorInstance.getTargetAtClientPoint === 'function') {
            const hit = editorInstance.getTargetAtClientPoint(e.clientX, e.clientY);
            if (hit?.position) {
                e.preventDefault(); e.stopPropagation();
                setTimeout(() => { editorInstance.setPosition(hit.position); editorInstance.focus(); }, 0);
            }
        }
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
