/**
 * RTL Engine — Font Metrics (Layer 3)
 *
 * Now that we have real Monaco editor instances via window.__rtlEditorService,
 * we can call updateOptions() with the correct Arabic font so Monaco's
 * DOMLineBreaksComputer measures character widths correctly.
 *
 * ROOT CAUSE OF WRONG WORD WRAP:
 * Monaco measures char widths using editor.options.fontFamily (Consolas ~7.8px/char)
 * but CSS renders using Vazirmatn (~10-12px/char). Monaco thinks the text fits,
 * so it doesn't wrap. Fix: tell Monaco the real font via updateOptions({ fontFamily }).
 */

export interface FontConfig {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

// Track applied editors — use editor ID (string) not WeakSet to allow re-apply on font change
const _configuredIds = new Set<string>();

/**
 * Apply RTL font + word wrap options to a Monaco editor instance.
 * Called whenever a non-code editor is detected; protected by ID set.
 */
export function applyRtlFont(editorInstance: any, config: FontConfig): void {
    if (!editorInstance) return;

    const editorId: string = editorInstance.getId?.() ?? '';
    if (editorId && _configuredIds.has(editorId)) return;
    if (editorId) _configuredIds.add(editorId);

    try {
        editorInstance.updateOptions({
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            fontFamily: config.fontFamily,   // ← Critical: Monaco measures wrap with THIS font
            fontSize: config.fontSize,       //   DOMLineBreaksComputer uses options.fontFamily
            lineHeight: config.lineHeight,   //   NOT CSS — so we must set it here
        });
        console.log('[RTL Engine] ✓ fontFamily + wordWrap:on applied to', editorId, '→', config.fontFamily);
    } catch (e) {
        console.warn('[RTL Engine] updateOptions failed:', e);
    }

    // Trigger re-layout after web fonts load so DOMLineBreaksComputer re-measures
    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            try {
                editorInstance.layout();
                console.log('[RTL Engine] ✓ layout() called after fonts ready for', editorId);
            } catch {}
        });
    }
}

/**
 * Reset configuration for an editor (e.g. when it goes back to LTR).
 */
export function restoreFont(editorInstance: any): void {
    const editorId: string = editorInstance?.getId?.() ?? '';
    if (editorId) _configuredIds.delete(editorId);
}

export function restoreAllFonts(): void {
    _configuredIds.clear();
}

export function forceRemeasureAll(): void {
    // No-op: done per-editor in applyRtlFont
}
