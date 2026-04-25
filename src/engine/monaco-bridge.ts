/**
 * RTL Engine — Monaco Bridge
 * Discovers and caches the Monaco API from VS Code's runtime environment.
 * Uses 4 progressively aggressive methods to find the monaco global.
 */

import { isMainCodeEditor, getEditorDomNode } from './utils';

let _cachedLib: any = null;
let _asyncDiscoveryStarted = false;
let _onDiscoveryCallbacks: Array<() => void> = [];

/**
 * Get the Monaco library object (`monaco.editor`).
 * Returns null if not yet available — call `onMonacoReady()` to be notified.
 */
export function getMonacoLib(): any {
    if (_cachedLib) return _cachedLib;

    // Method 1: global `monaco`
    try {
        if (typeof (window as any).monaco !== 'undefined' && (window as any).monaco?.editor) {
            _cachedLib = (window as any).monaco;
            return _cachedLib;
        }
    } catch {}

    // Method 2: AMD requirejs module cache
    try {
        const ctx = (window as any).require?.s?.contexts?._;
        const defined = ctx?.defined;
        if (defined) {
            for (const key of Object.keys(defined)) {
                const mod = defined[key];
                if (mod?.editor && typeof mod.editor.getEditors === 'function') {
                    _cachedLib = mod;
                    return _cachedLib;
                }
            }
        }
    } catch {}

    // Method 3: sync require
    try {
        const req = (typeof require !== 'undefined' ? require : null) || (window as any).require;
        if (req) {
            const m = req('vs/editor/editor.main');
            if (m?.editor) {
                _cachedLib = m;
                return _cachedLib;
            }
        }
    } catch {}

    // Method 4: async require (one-time setup)
    if (!_asyncDiscoveryStarted) {
        _asyncDiscoveryStarted = true;
        try {
            const asyncReq = (typeof require !== 'undefined' ? require : null) || (window as any).require;
            if (asyncReq && typeof asyncReq === 'function') {
                asyncReq(
                    ['vs/editor/editor.main'],
                    (m: any) => {
                        if (m?.editor && typeof m.editor.getEditors === 'function') {
                            _cachedLib = m;
                            console.log('[RTL Engine] Monaco discovered via async require');
                            _onDiscoveryCallbacks.forEach(cb => cb());
                            _onDiscoveryCallbacks = [];
                        }
                    },
                    () => {}
                );
            }
        } catch {}
    }

    return null;
}

/** Register a callback to be called when Monaco is discovered (if not already). */
export function onMonacoReady(callback: () => void): void {
    if (_cachedLib) {
        callback();
    } else {
        _onDiscoveryCallbacks.push(callback);
        // Trigger discovery attempt
        getMonacoLib();
    }
}

/** Get all non-code Monaco editor instances (chat inputs, etc.) */
export function getNonCodeEditors(): Array<{ instance: any; domNode: HTMLElement }> {
    const lib = getMonacoLib();
    if (!lib) return [];
    const results: Array<{ instance: any; domNode: HTMLElement }> = [];
    try {
        const editors = lib.editor.getEditors();
        for (const editor of editors) {
            const dn = getEditorDomNode(editor);
            if (dn && !isMainCodeEditor(dn)) {
                results.push({ instance: editor, domNode: dn });
            }
        }
    } catch {}
    return results;
}

/** Find the Monaco editor instance that owns a given DOM element. */
export function findEditorForDom(
    monacoDom: Element,
    editorRecords: Array<{ instance: any; domNode: HTMLElement }>
): any | null {
    for (const rec of editorRecords) {
        if (!rec.domNode) continue;
        if (rec.domNode === monacoDom) return rec.instance;
        if (rec.domNode.contains(monacoDom) || monacoDom.contains(rec.domNode)) return rec.instance;
    }
    return null;
}
