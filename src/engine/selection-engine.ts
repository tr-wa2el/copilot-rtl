/**
 * RTL Engine — Selection Engine (Layer 5)
 * Corrects selection highlighting for RTL/bidi text in Monaco editors.
 *
 * Strategy:
 * Monaco renders selection as absolutely-positioned <div> elements with
 * left/width calculated from its LTR character-width cache. For RTL text,
 * these rectangles are wrong.
 *
 * We use the browser's Range.getClientRects() on the actual DOM to get
 * correct visual selection rectangles, then overlay our own highlights.
 */

import { CSS_CLASS } from './constants';
import { isMainCodeEditor } from './utils';

let _selectionOverlayContainer: HTMLElement | null = null;
let _selectionObserver: MutationObserver | null = null;
const _observedSelectionLayers = new WeakSet<Element>();

// ── Selection Overlay Container ───────────────────────────────────────

function getOrCreateOverlayContainer(): HTMLElement {
    if (!_selectionOverlayContainer) {
        _selectionOverlayContainer = document.getElementById('copilot-rtl-selection-overlay');
        if (!_selectionOverlayContainer) {
            _selectionOverlayContainer = document.createElement('div');
            _selectionOverlayContainer.id = 'copilot-rtl-selection-overlay';
            _selectionOverlayContainer.style.cssText = 'position: fixed; top: 0; left: 0; pointer-events: none; z-index: 99999;';
            document.body.appendChild(_selectionOverlayContainer);
        }
    }
    return _selectionOverlayContainer;
}

function clearSelectionOverlay(): void {
    if (_selectionOverlayContainer) {
        _selectionOverlayContainer.innerHTML = '';
    }
}

// ── Selection Rendering ───────────────────────────────────────────────

function renderSelectionForEditor(monacoEditor: Element): void {
    if (!monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) return;

    const selectionsLayer = monacoEditor.querySelector('.selected-text');
    if (!selectionsLayer) return;

    // Check if there are any Monaco selection divs
    const selectionDivs = selectionsLayer.querySelectorAll('div');
    if (selectionDivs.length === 0) {
        clearSelectionOverlay();
        return;
    }

    // Get the view-lines to find the actual text DOM
    const linesContent = monacoEditor.querySelector('.lines-content');
    if (!linesContent) return;

    const viewLines = linesContent.querySelectorAll('.view-line');
    if (viewLines.length === 0) return;

    // Get the editor's selection from Monaco API — but since we don't have
    // direct access here, we approximate by reading the selection divs'
    // top positions to find which view-lines are selected
    const container = getOrCreateOverlayContainer();
    container.innerHTML = '';

    for (let sd = 0; sd < selectionDivs.length; sd++) {
        const selDiv = selectionDivs[sd] as HTMLElement;
        const selTop = parseFloat(selDiv.style.top || '0');
        const selHeight = parseFloat(selDiv.style.height || '0');

        if (!selHeight) continue;

        // Find the matching view-line by top position
        let matchedLine: HTMLElement | null = null;
        for (let vl = 0; vl < viewLines.length; vl++) {
            const vlEl = viewLines[vl] as HTMLElement;
            const vlTop = parseFloat(vlEl.style.top || '0');
            if (Math.abs(vlTop - selTop) < 2) {
                matchedLine = vlEl;
                break;
            }
        }

        if (!matchedLine) continue;

        // Get the bounding rect of the view-line for positioning
        const lineRect = matchedLine.getBoundingClientRect();

        // For full-line selections, just use the line rect
        const selLeft = parseFloat(selDiv.style.left || '0');
        const selWidth = parseFloat(selDiv.style.width || '0');

        // Create overlay highlight div using the corrected geometry
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: ${lineRect.top}px;
            left: ${lineRect.left + selLeft}px;
            width: ${selWidth || lineRect.width}px;
            height: ${lineRect.height}px;
            background-color: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.5));
            pointer-events: none;
        `;
        container.appendChild(overlay);
    }
}

// ── Selection Layer Observation ────────────────────────────────────────

export function observeSelectionLayers(): void {
    if (!_selectionObserver) {
        _selectionObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                const target = m.target as Element;
                if (!target.closest) continue;

                const monacoEditor = target.closest('.monaco-editor');
                if (monacoEditor && monacoEditor.classList.contains(CSS_CLASS.EDITOR_RTL)) {
                    if (!isMainCodeEditor(monacoEditor)) {
                        requestAnimationFrame(() => renderSelectionForEditor(monacoEditor));
                    }
                }
            }
        });
    }

    const layers = document.querySelectorAll('.selected-text');
    for (let i = 0; i < layers.length; i++) {
        const parent = layers[i].closest('.monaco-editor');
        if (parent && parent.classList.contains(CSS_CLASS.EDITOR_RTL) && !_observedSelectionLayers.has(layers[i])) {
            _observedSelectionLayers.add(layers[i]);
            _selectionObserver.observe(layers[i], {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style'],
            });
        }
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────

export function destroySelectionEngine(): void {
    clearSelectionOverlay();
    if (_selectionOverlayContainer?.parentNode) {
        _selectionOverlayContainer.parentNode.removeChild(_selectionOverlayContainer);
        _selectionOverlayContainer = null;
    }
    if (_selectionObserver) {
        _selectionObserver.disconnect();
        _selectionObserver = null;
    }
}
