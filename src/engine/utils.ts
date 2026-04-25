/**
 * RTL Engine — Utilities
 * Pure helper functions with no side effects.
 */

import { ARABIC_RE, CODE_EDITOR_ANCESTORS } from './constants';

/** Check if text contains Arabic or other RTL characters. */
export function isArabicOrMixed(text: string): boolean {
    return ARABIC_RE.test(text);
}

/** Check if a Monaco editor element is the main code editor (vs chat input). */
export function isMainCodeEditor(monacoEl: Element | null): boolean {
    if (!monacoEl || !monacoEl.closest) return false;
    for (const ancestor of CODE_EDITOR_ANCESTORS) {
        if (monacoEl.closest(ancestor)) return true;
    }
    return false;
}

/** Trailing-edge debounce — only fires after calls stop for `ms`. */
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return ((...args: any[]) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, ms);
    }) as unknown as T;
}

/**
 * Get the container DOM node for a Monaco editor instance.
 * Handles both `getContainerDomNode()` and `getDomNode()` APIs.
 */
export function getEditorDomNode(editorInstance: any): HTMLElement | null {
    try {
        return editorInstance.getContainerDomNode
            ? editorInstance.getContainerDomNode()
            : editorInstance.getDomNode();
    } catch {
        return null;
    }
}

/**
 * Get caret coordinates from a text node container at a given character offset.
 * Uses the browser's Range API — respects actual glyph positions including
 * ligatures, kerning, and bidi reordering. This is the GROUND TRUTH for
 * visual position (never use Canvas measureText or DOM clones instead).
 */
export function getCaretCoordinatesFromTextNode(
    container: Element,
    targetTextOffset: number
): DOMRect | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;
    let currentOffset = 0;
    const range = document.createRange();

    while ((node = walker.nextNode() as Text | null)) {
        const len = node.nodeValue!.length;
        if (currentOffset + len >= targetTextOffset) {
            const offsetInNode = Math.max(0, Math.min(targetTextOffset - currentOffset, len));
            range.setStart(node, offsetInNode);
            range.setEnd(node, offsetInNode);
            return range.getBoundingClientRect();
        }
        currentOffset += len;
    }

    // Fallback: end of last text node
    const w2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let lastNode: Text | null = null;
    while ((node = w2.nextNode() as Text | null)) { lastNode = node; }
    if (lastNode) {
        range.setStart(lastNode, lastNode.nodeValue!.length);
        range.setEnd(lastNode, lastNode.nodeValue!.length);
        return range.getBoundingClientRect();
    }
    return null;
}
