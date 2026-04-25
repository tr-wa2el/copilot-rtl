/**
 * RTL Engine — Cursor Engine (Layer 4)
 * Pixel-perfect cursor positioning for RTL text in Monaco editors.
 *
 * Architecture (proven through versions 0.1.10→0.2.0):
 * - Click mapping: getTargetAtClientPoint() — let Monaco be the truth
 * - Visual cursor: DOM Range API on actual .view-line — let browser be the truth
 * - NEVER: Canvas measureText per-char sums, string heuristics, bidi-override clones
 */

import { CSS_CLASS, ELEMENT_ID } from './constants';
import { getCaretCoordinatesFromTextNode, isMainCodeEditor } from './utils';
import { getMonacoLib, findEditorForDom, getNonCodeEditors } from './monaco-bridge';

let _ghostCursor: HTMLElement | null = null;
const _attachedEditors = new WeakSet<any>();
const _observedCursorLayers = new WeakSet<Element>();
let _cursorObserver: MutationObserver | null = null;
let _pointerdownAttached = false;

export interface CursorConfig {
    fontSize: string;
    lineHeight: string;
}

// ── Ghost Cursor Element ──────────────────────────────────────────────

function getOrCreateGhostCursor(): HTMLElement {
    if (!_ghostCursor) {
        _ghostCursor = document.getElementById(ELEMENT_ID.GHOST_CURSOR) as HTMLElement;
        if (!_ghostCursor) {
            _ghostCursor = document.createElement('div');
            _ghostCursor.id = ELEMENT_ID.GHOST_CURSOR;
            _ghostCursor.className = 'blink';
            document.body.appendChild(_ghostCursor);
            _ghostCursor.style.display = 'none';
        }
    }
    return _ghostCursor;
}

export function hideGhostCursor(): void {
    if (_ghostCursor) _ghostCursor.style.display = 'none';
}

// ── DOM-based Ghost Cursor Positioning ────────────────────────────────
// Uses the ACTUAL rendered DOM to find cursor visual position.
// This is the ground truth — respects ligatures, kerning, bidi reorder.
// Clone preserves the original direction/bidi/shaping — NO bidi-override.

function findOffsetFromMonacoLeft(realLineElement: Element, monacoLeft: number): number {
    const walker = document.createTreeWalker(realLineElement, NodeFilter.SHOW_TEXT, null);
    let totalLength = 0;
    while (walker.nextNode()) {
        totalLength += (walker.currentNode as Text).nodeValue!.length;
    }
    if (totalLength === 0) return 0;

    // Clone the line — keep original direction/bidi so shaping is preserved
    const clone = realLineElement.cloneNode(true) as HTMLElement;
    clone.style.cssText = 'position: absolute; visibility: hidden; top: 0; left: 0; width: max-content; white-space: pre;';
    realLineElement.parentNode!.appendChild(clone);

    const cloneRect = clone.getBoundingClientRect();
    let bestOffset = 0;
    let minDiff = Infinity;
    const range = document.createRange();

    // Binary search for performance on longer lines
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
    let cNode: Text | null;
    let currentOffset = 0;
    const nodeInfos: Array<{ node: Text; startOffset: number; len: number }> = [];

    while ((cNode = cloneWalker.nextNode() as Text | null)) {
        const len = cNode.nodeValue!.length;
        nodeInfos.push({ node: cNode, startOffset: currentOffset, len });
        currentOffset += len;
    }

    for (const info of nodeInfos) {
        // Binary search within this text node
        let lo = 0, hi = info.len;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            try {
                range.setStart(info.node, mid);
                range.setEnd(info.node, mid);
                const r = range.getBoundingClientRect();
                const relativeLeft = r.left - cloneRect.left;
                const diff = Math.abs(relativeLeft - monacoLeft);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestOffset = info.startOffset + mid;
                }
                if (relativeLeft < monacoLeft) lo = mid + 1;
                else hi = mid - 1;
            } catch { break; }
        }
        // Also check neighborhood around best for sub-pixel precision
        const localBest = bestOffset - info.startOffset;
        for (let j = Math.max(0, localBest - 2); j <= Math.min(info.len, localBest + 2); j++) {
            try {
                range.setStart(info.node, j);
                range.setEnd(info.node, j);
                const r = range.getBoundingClientRect();
                const relativeLeft = r.left - cloneRect.left;
                const diff = Math.abs(relativeLeft - monacoLeft);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestOffset = info.startOffset + j;
                }
            } catch {}
        }
    }

    clone.remove();
    return bestOffset;
}

function updateGhostCursorFromDOM(cursorElement: Element, config: CursorConfig): void {
    const monacoEditor = cursorElement.closest('.monaco-editor');
    if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) {
        return hideGhostCursor();
    }

    const linesContent = monacoEditor.querySelector('.lines-content');
    if (!linesContent) return hideGhostCursor();

    // Read cursor position from its style (set by Monaco internally)
    const topStr = (cursorElement as HTMLElement).style.top;
    const leftStr = (cursorElement as HTMLElement).style.left;

    // Also check transform (newer VS Code versions use translate3d)
    let monacoTop = 0, monacoLeft = 0;
    const transform = (cursorElement as HTMLElement).style.transform;
    if (transform && transform.indexOf('translate3d') !== -1) {
        const match = transform.match(/translate3d\(([^,]+),\s*([^,]+)/);
        if (match) {
            monacoLeft = parseFloat(match[1]);
            monacoTop = parseFloat(match[2]);
        }
    } else {
        if (!topStr && !leftStr) return;
        monacoTop = parseFloat(topStr || '0');
        monacoLeft = parseFloat(leftStr || '0');
    }

    // Find the view-line at this vertical position
    const viewLines = linesContent.querySelectorAll('.view-line');
    let targetLineElement: Element | null = null;
    for (let i = 0; i < viewLines.length; i++) {
        const vl = viewLines[i] as HTMLElement;
        let vlTop = parseFloat(vl.style.top || '0');
        // Some versions use transform on view-lines too
        const vlTransform = vl.style.transform;
        if (vlTransform && vlTransform.indexOf('translate') !== -1) {
            const m = vlTransform.match(/translate[3d]*\([^,]*,\s*([^,)]+)/);
            if (m) vlTop = parseFloat(m[1]);
        }
        if (Math.abs(vlTop - monacoTop) < 2) {
            targetLineElement = vl;
            break;
        }
    }

    if (targetLineElement) {
        const targetOffset = findOffsetFromMonacoLeft(targetLineElement, monacoLeft);
        const rect = getCaretCoordinatesFromTextNode(targetLineElement, targetOffset);

        if (rect) {
            const gc = getOrCreateGhostCursor();
            gc.style.display = 'block';
            gc.style.left = rect.left + 'px';
            gc.style.top = rect.top + 'px';
            gc.style.height = (rect.height || parseFloat(config.fontSize) * parseFloat(config.lineHeight) || 20) + 'px';

            // Restart blink animation
            gc.classList.remove('blink');
            void gc.offsetWidth;
            gc.classList.add('blink');

            if (!monacoEditor.classList.contains(CSS_CLASS.GHOST_ATTACHED)) {
                monacoEditor.classList.add(CSS_CLASS.GHOST_ATTACHED);
            }
            return;
        }
    }
    hideGhostCursor();
}

// ── Cursor Layer Observation ──────────────────────────────────────────

export function observeCursorLayers(config: CursorConfig): void {
    if (!_cursorObserver) {
        _cursorObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                const target = m.target as HTMLElement;
                if (!target.classList) continue;

                if (target.classList.contains('cursor')) {
                    if (target.style.display === 'none' || target.style.visibility === 'hidden') {
                        hideGhostCursor();
                    } else {
                        updateGhostCursorFromDOM(target, config);
                    }
                } else if (target.classList.contains('cursors-layer')) {
                    const cursors = target.querySelectorAll('.cursor');
                    if (cursors.length === 0) hideGhostCursor();
                    else updateGhostCursorFromDOM(cursors[0], config);
                }
            }
        });
    }

    const layers = document.querySelectorAll('.cursors-layer');
    for (let i = 0; i < layers.length; i++) {
        if (!_observedCursorLayers.has(layers[i])) {
            _observedCursorLayers.add(layers[i]);
            _cursorObserver.observe(layers[i], {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style'],
            });
        }
    }
}

// ── Click-to-Position Interception ────────────────────────────────────
// Intercepts pointerdown on RTL Monaco editors, uses getTargetAtClientPoint
// to correctly map click coordinates → logical position.
// Monaco is the source of truth — no pixel math, no DOM offset tricks.

export function attachClickInterceptor(): void {
    if (_pointerdownAttached) return;
    _pointerdownAttached = true;

    document.addEventListener('pointerdown', (e: PointerEvent) => {
        const target = e.target as Element;
        if (!target?.closest) return;

        const monacoEditor = target.closest('.monaco-editor');
        if (!monacoEditor || !monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;
        if (isMainCodeEditor(monacoEditor)) return;

        // Find the editor instance for this DOM element
        const editorRecords = getNonCodeEditors();
        const editorInstance = findEditorForDom(monacoEditor, editorRecords);
        if (!editorInstance) return;

        // Only intercept clicks on the text area, not buttons/widgets
        const viewLines = monacoEditor.querySelector('.view-lines');
        if (!viewLines || !viewLines.contains(target)) return;

        // Use Monaco's own hit-testing — this is the ONLY correct way
        if (typeof editorInstance.getTargetAtClientPoint === 'function') {
            const hitTarget = editorInstance.getTargetAtClientPoint(e.clientX, e.clientY);
            if (hitTarget && hitTarget.position) {
                e.preventDefault();
                e.stopPropagation();
                setTimeout(() => {
                    editorInstance.setPosition(hitTarget.position);
                    editorInstance.focus();
                }, 0);
            }
        }
    }, true);
}

// ── Editor Lifecycle ──────────────────────────────────────────────────

export function attachClickHandler(editorInstance: any): void {
    if (!editorInstance || _attachedEditors.has(editorInstance)) return;
    _attachedEditors.add(editorInstance);

    try {
        // Hide ghost cursor on blur
        editorInstance.onDidBlurEditorText?.(() => hideGhostCursor());
    } catch {}

    // Ensure global click interceptor is attached
    attachClickInterceptor();
}

// ── Cleanup ───────────────────────────────────────────────────────────

export function destroyCursorEngine(): void {
    if (_ghostCursor?.parentNode) {
        _ghostCursor.parentNode.removeChild(_ghostCursor);
        _ghostCursor = null;
    }
    if (_cursorObserver) {
        _cursorObserver.disconnect();
        _cursorObserver = null;
    }
}
