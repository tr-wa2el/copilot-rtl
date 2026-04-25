/**
 * RTL Engine — Font Metrics Bridge (Layer 3)
 * Synchronizes Monaco's internal character-width cache with the actual RTL font.
 */

import { getMonacoLib } from './monaco-bridge';

/** Stored original options per editor instance so we can restore on disable. */
const _originals = new WeakMap<any, Record<string, any>>();

/** Track which editors have a pending layout pass to avoid redundant calls. */
const _layoutScheduled = new WeakSet<any>();

export interface FontConfig {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

/**
 * Apply RTL font metrics to a Monaco editor instance.
 * This calls `updateOptions()` which updates Monaco's internal character-width
 * cache so word-wrap metrics match the visual font.
 */
export function applyRtlFont(editorInstance: any, config: FontConfig): void {
    if (!editorInstance) return;
    try {
        const fs = config.fontSize;
        const lh = config.lineHeight;
        if (!(fs > 0) || !(lh > 0)) return;

        // Save originals for restoration
        if (!_originals.has(editorInstance)) {
            const raw = editorInstance.getRawOptions?.() ?? {};
            _originals.set(editorInstance, {
                fontSize: raw.fontSize,
                fontFamily: raw.fontFamily,
                lineHeight: raw.lineHeight,
                wordWrap: raw.wordWrap,
                wrappingStrategy: raw.wrappingStrategy,
                allowVariableFonts: raw.allowVariableFonts,
            });
        }

        editorInstance.updateOptions({
            fontSize: fs,
            fontFamily: config.fontFamily + ', sans-serif',
            lineHeight: Math.round(fs * lh),
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            allowVariableFonts: true,
        });

        scheduleRemeasure(editorInstance);
    } catch (e) {
        console.error('[RTL Engine] applyRtlFont error:', e);
    }
}

/** Restore original font options on a Monaco editor instance. */
export function restoreFont(editorInstance: any): void {
    if (!editorInstance) return;
    try {
        if (_originals.has(editorInstance)) {
            editorInstance.updateOptions(_originals.get(editorInstance)!);
            _originals.delete(editorInstance);
        }
    } catch {}
}

/** Restore all tracked non-code editor fonts. */
export function restoreAllFonts(): void {
    const lib = getMonacoLib();
    if (!lib) return;
    try {
        for (const editor of lib.editor.getEditors()) {
            restoreFont(editor);
        }
    } catch {}
}

/** Schedule font remeasure + layout after font changes. */
function scheduleRemeasure(editorInstance: any): void {
    if (_layoutScheduled.has(editorInstance)) return;
    _layoutScheduled.add(editorInstance);

    function doRemeasure() {
        try {
            const lib = getMonacoLib();
            if (lib?.editor?.remeasureFonts) lib.editor.remeasureFonts();
            editorInstance.layout();
            if (editorInstance.render) editorInstance.render(true, true);
        } catch {}
    }

    function start() {
        _layoutScheduled.delete(editorInstance);
        doRemeasure();
        setTimeout(doRemeasure, 150);
        setTimeout(doRemeasure, 500);
    }

    if (document.fonts?.ready) {
        document.fonts.ready.then(() => requestAnimationFrame(start));
    } else {
        requestAnimationFrame(start);
    }
}
