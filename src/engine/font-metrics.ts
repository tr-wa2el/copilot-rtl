/**
 * RTL Engine — Font Metrics Bridge (Layer 3) — ROOT FIX
 * 
 * CRITICAL CHANGE: NO LONGER changes Monaco's fontFamily via updateOptions().
 * 
 * Old approach (BROKEN):
 *   - updateOptions({ fontFamily: 'vazirmatn' }) → changes Monaco's internal
 *     character-width cache to Arabic font metrics → word wrap is calculated
 *     using Arabic widths for ALL text including English → WRONG
 *   
 * New approach (ROOT FIX):
 *   - Font is applied via CSS only (per-line, see rendering-patcher)
 *   - Monaco's internal metrics stay with the default monospace font
 *   - Only wrapping strategy and word wrap mode are set via updateOptions()
 *   - This means English text has perfect word wrap
 *   - Arabic word wrap won't be pixel-perfect but won't overflow
 */

import { getMonacoLib } from './monaco-bridge';

/** Stored original options per editor instance. */
const _originals = new WeakMap<any, Record<string, any>>();

/** Track which editors have been configured. */
const _configured = new WeakSet<any>();

export interface FontConfig {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

/**
 * Configure Monaco editor for mixed RTL/LTR content.
 * Only sets wrapping options — does NOT change fontFamily or fontSize.
 * Font is applied via CSS per-line.
 */
export function configureForRtl(editorInstance: any): void {
    if (!editorInstance || _configured.has(editorInstance)) return;
    _configured.add(editorInstance);

    try {
        // Save originals for restoration
        if (!_originals.has(editorInstance)) {
            const raw = editorInstance.getRawOptions?.() ?? {};
            _originals.set(editorInstance, {
                wordWrap: raw.wordWrap,
                wrappingStrategy: raw.wrappingStrategy,
            });
        }

        // Only set wrapping — font is CSS-only
        editorInstance.updateOptions({
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
        });

        scheduleLayout(editorInstance);
    } catch (e) {
        console.error('[RTL Engine] configureForRtl error:', e);
    }
}

/** Restore original options on a Monaco editor instance. */
export function restoreFont(editorInstance: any): void {
    if (!editorInstance) return;
    try {
        _configured.delete(editorInstance);
        if (_originals.has(editorInstance)) {
            editorInstance.updateOptions(_originals.get(editorInstance)!);
            _originals.delete(editorInstance);
        }
    } catch {}
}

/** Restore all tracked non-code editor options. */
export function restoreAllFonts(): void {
    const lib = getMonacoLib();
    if (!lib) return;
    try {
        for (const editor of lib.editor.getEditors()) {
            restoreFont(editor);
        }
    } catch {}
}

/** Schedule layout recalculation. */
function scheduleLayout(editorInstance: any): void {
    requestAnimationFrame(() => {
        try {
            editorInstance.layout();
        } catch {}
    });
}
