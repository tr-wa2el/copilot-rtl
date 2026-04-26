/**
 * RTL Engine — Monaco Bridge
 *
 * Accesses Monaco editors via window.__rtlEditorService which is exposed
 * by a direct patch to workbench.desktop.main.js:
 *
 *   addCodeEditor(e) {
 *     this._codeEditors[e.getId()] = e;
 *     this._onCodeEditorAdd.fire(e);
 *     window.__rtlEditorService = this;  // ← OUR PATCH
 *   }
 *
 * This gives us the real ICodeEditorService including EmbeddedCodeEditorWidget
 * (Copilot Chat input) which is NOT accessible via window.require (= null).
 */

import { isMainCodeEditor, getEditorDomNode } from './utils';

let _cachedService: any = null;

function getEditorService(): any | null {
    if (_cachedService) return _cachedService;
    const svc = (window as any).__rtlEditorService;
    if (svc && typeof svc.listCodeEditors === 'function') {
        _cachedService = svc;
        console.log('[RTL Engine] ✓ __rtlEditorService found! editors:', svc.listCodeEditors().length);
    }
    return _cachedService;
}

export function getMonacoLib(): any {
    return null; // window.require = null in VS Code renderer; use getEditorService() instead
}

export function onMonacoReady(callback: () => void): void {
    // Poll until __rtlEditorService is set (by our workbench.desktop.main.js patch)
    const check = () => {
        if (getEditorService()) { callback(); }
        else { setTimeout(check, 500); }
    };
    check();
}

export function getNonCodeEditors(): Array<{ instance: any; domNode: HTMLElement }> {
    const results: Array<{ instance: any; domNode: HTMLElement }> = [];
    const svc = getEditorService();
    if (!svc) return results;

    try {
        const all: any[] = svc.listCodeEditors();
        for (const editor of all) {
            try {
                const dn = getEditorDomNode(editor);
                if (dn && !isMainCodeEditor(dn)) {
                    results.push({ instance: editor, domNode: dn });
                }
            } catch {}
        }
    } catch {}

    return results;
}

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

export function invalidateDomEditorCache(_el: Element): void {
    _cachedService = null; // force re-check on next call
}
