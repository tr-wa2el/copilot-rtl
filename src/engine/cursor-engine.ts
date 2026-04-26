/**
 * RTL Engine — Cursor Engine (Layer 4) v3
 *
 * Hybrid approach:
 * - RTL lines: Monaco getScrolledVisiblePosition() works correctly ✓
 * - LTR lines: Monaco returns editorW for all positions (bug in RTL container),
 *   so we use DOM Range API on the actual view-line element instead.
 */

import { CSS_CLASS, ELEMENT_ID } from './constants';
import { isMainCodeEditor, getCaretCoordinatesFromTextNode } from './utils';
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

// ── LTR fallback: DOM Range on actual view-line ────────────────────────
// Monaco's getScrolledVisiblePosition returns editorWidth for all LTR
// columns in an RTL container — it's broken for LTR in RTL context.
// DOM Range gives us the actual rendered glyph position.

function getLtrCursorFromDom(
    viewLineEl: HTMLElement,
    column: number,   // 1-based Monaco column
    monacoEditor: Element,
    config: CursorConfig
): void {
    // Build text-node offset from logical column
    const walker = document.createTreeWalker(viewLineEl, NodeFilter.SHOW_TEXT, null);
    let remaining = column - 1; // column is 1-based
    let node: Text | null = null;
    let offset = 0;

    while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        const len = t.nodeValue!.length;
        if (remaining <= len) { node = t; offset = remaining; break; }
        remaining -= len;
    }
    if (!node) return;

    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return; // degenerate range

    const height = parseFloat(config.fontSize) * parseFloat(config.lineHeight) || 20;
    showGhostCursor(monacoEditor, rect.left, rect.top, height);
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

        // Find the view-line for this visual top offset (to detect LTR vs RTL)
        const viewLines = monacoEditor.querySelectorAll('.view-line');
        let lineEl: HTMLElement | null = null;
        for (let i = 0; i < viewLines.length; i++) {
            const vl = viewLines[i] as HTMLElement;
            const vlTop = vl.getBoundingClientRect().top - editorRect.top;
            if (Math.abs(vlTop - visualPos.top) < 3) { lineEl = vl; break; }
        }

        // Determine if this line is LTR
        const isLtr = lineEl?.getAttribute('data-rtl-dir') === 'ltr'
            // fallback: if visualLeft == editorW, Monaco is reporting LTR-broken value
            || visualPos.left >= editorRect.width - 2;

        if (isLtr) {
            // ── LTR strategy: read Monaco's OWN cursor element ─────────────
            // Monaco computes .cursors-layer .cursor style.left CORRECTLY for LTR.
            // Even with opacity:0, getBoundingClientRect() returns visual position.
            // getScrolledVisiblePosition is broken for LTR in RTL containers.
            const monacoNativeCursor = monacoEditor.querySelector(
                '.cursors-layer .cursor'
            ) as HTMLElement | null;
            if (monacoNativeCursor) {
                const cr = monacoNativeCursor.getBoundingClientRect();
                if (cr.width > 0 || cr.height > 0) {
                    showGhostCursor(monacoEditor, cr.left, cr.top, cr.height || ghostH);
                    return;
                }
            }
            // fallback: show ghost at editorRect.left (beginning of LTR line)
            showGhostCursor(monacoEditor, editorRect.left, editorRect.top + visualPos.top, ghostH);
            return;
        }

        // RTL: Monaco's visualLeft is correct (verified from debug data)
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

// ── Cursor Layers (no-op — driven by onDidChangeCursorPosition) ───────
export function observeCursorLayers(_config: CursorConfig): void {}

// ── Click Interceptor ─────────────────────────────────────────────────
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

// ── Editor Lifecycle ──────────────────────────────────────────────────
export function attachClickHandler(editorInstance: any, config?: CursorConfig): void {
    if (!editorInstance || _attachedEditors.has(editorInstance)) return;
    _attachedEditors.add(editorInstance);
    try {
        const domNode = editorInstance.getDomNode?.() as HTMLElement | null;
        const monacoEditor = domNode?.closest('.monaco-editor') ?? domNode;
        if (!monacoEditor) return;
        const cfg = config ?? { fontSize: '14', lineHeight: '1.8' };
        editorInstance.onDidChangeCursorPosition?.(() =>
            updateGhostFromEditorApi(editorInstance, monacoEditor, cfg));
        editorInstance.onDidFocusEditorText?.(() => {
            if (monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL))
                updateGhostFromEditorApi(editorInstance, monacoEditor, cfg);
        });
        editorInstance.onDidBlurEditorText?.(() => hideGhostCursor());
    } catch {}
    attachClickInterceptor();
}

export function destroyCursorEngine(): void {
    _ghostCursor?.parentNode?.removeChild(_ghostCursor);
    _ghostCursor = null;
}
