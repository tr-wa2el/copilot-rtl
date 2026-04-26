/**
 * RTL Engine — Lifecycle Manager (Layer 8)
 * 
 * Per-line direction + updateOptions font metrics for word wrap.
 */

import { debounce } from './utils';
import { onMonacoReady } from './monaco-bridge';
import {
    injectStyles, removeStyles, removeAllClasses,
    scanAllMarkdown, scanResponseContainers, scanLexicalInputs,
    type RenderConfig,
} from './rendering-patcher';
import { processNonCodeMonacos, setupInputListeners, clearStickyState } from './direction-manager';
import { restoreAllFonts, forceRemeasureAll } from './font-metrics';
import { destroyCursorEngine, hideGhostCursor } from './cursor-engine';
import { observeSelectionLayers, destroySelectionEngine } from './selection-engine';
import { attachKeyboardInterceptor, fixInputAreaDirection, preventDirectionToggle } from './input-interceptor';
import type { CursorConfig } from './cursor-engine';

// ── Configuration ─────────────────────────────────────────────────────
// @ts-ignore
declare const __RTL_FONT_FAMILY__: string;
// @ts-ignore
declare const __RTL_FONT_SIZE__: number;
// @ts-ignore
declare const __RTL_LINE_HEIGHT__: number;
// @ts-ignore
declare const __LTR_FONT_FAMILY__: string;
// @ts-ignore
declare const __LTR_FONT_SIZE__: number;
// @ts-ignore
declare const __LTR_LINE_HEIGHT__: number;
// @ts-ignore
declare const __RTL_TEXT_ALIGN__: string;
// @ts-ignore
declare const __EXT_VERSION__: string;

const RTL_FONT_FAMILY = typeof __RTL_FONT_FAMILY__ !== 'undefined' ? __RTL_FONT_FAMILY__ + ', sans-serif' : 'vazirmatn, sans-serif';
const RTL_FONT_SIZE = typeof __RTL_FONT_SIZE__ !== 'undefined' ? __RTL_FONT_SIZE__ : 13;
const RTL_LINE_HEIGHT = typeof __RTL_LINE_HEIGHT__ !== 'undefined' ? __RTL_LINE_HEIGHT__ : 1.8;
const LTR_FONT_FAMILY = typeof __LTR_FONT_FAMILY__ !== 'undefined' ? __LTR_FONT_FAMILY__ : '';
const LTR_FONT_SIZE = typeof __LTR_FONT_SIZE__ !== 'undefined' ? __LTR_FONT_SIZE__ : 0;
const LTR_LINE_HEIGHT = typeof __LTR_LINE_HEIGHT__ !== 'undefined' ? __LTR_LINE_HEIGHT__ : 0;
const RTL_TEXT_ALIGN = typeof __RTL_TEXT_ALIGN__ !== 'undefined' ? __RTL_TEXT_ALIGN__ : 'right';
const EXT_VERSION = typeof __EXT_VERSION__ !== 'undefined' ? __EXT_VERSION__ : '0.3.0';

// ── Derived Configs ───────────────────────────────────────────────────

const renderConfig: RenderConfig = {
    rtlFontFamily: RTL_FONT_FAMILY,
    rtlFontSize: RTL_FONT_SIZE + 'px',
    rtlLineHeight: String(RTL_LINE_HEIGHT),
    rtlTextAlign: RTL_TEXT_ALIGN,
    ltrFontFamily: LTR_FONT_FAMILY,
    ltrFontSize: LTR_FONT_SIZE > 0 ? LTR_FONT_SIZE + 'px' : '',
    ltrLineHeight: LTR_LINE_HEIGHT > 0 ? String(LTR_LINE_HEIGHT) : '',
};

import type { FontConfig } from './font-metrics';

const fontConfig: FontConfig = {
    fontFamily: RTL_FONT_FAMILY,
    fontSize: RTL_FONT_SIZE,
    lineHeight: RTL_LINE_HEIGHT,
};

const cursorConfig: CursorConfig = {
    fontSize: RTL_FONT_SIZE + 'px',
    lineHeight: String(RTL_LINE_HEIGHT),
};

// ── Engine State ──────────────────────────────────────────────────────

let _enabled = true;
let _observer: MutationObserver | null = null;
let _mainInterval: ReturnType<typeof setInterval> | null = null;

// ── Streaming stabilization ───────────────────────────────────────────
let _isStreaming = false;
let _stabilizeTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleStabilize(): void {
    _isStreaming = true;
    if (_stabilizeTimeout) clearTimeout(_stabilizeTimeout);
    _stabilizeTimeout = setTimeout(() => {
        _stabilizeTimeout = null;
        _isStreaming = false;
        scanAll();
    }, 400);
}

// ── Scan Functions ────────────────────────────────────────────────────

function scanAll(): void {
    scanAllMarkdown(_isStreaming, renderConfig);
    scanResponseContainers(_isStreaming, renderConfig);
}

// ── KaTeX Warning Suppression ─────────────────────────────────────────

function suppressKatexWarnings(): void {
    const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const _origWarn = console.warn;
    console.warn = function (...args: any[]) {
        const msg = args[0] != null ? String(args[0]) : '';
        if (
            (msg.indexOf('[unknownSymbol]') !== -1 || msg.indexOf('No character metrics') !== -1) &&
            ARABIC_RE.test(msg)
        ) {
            return;
        }
        return _origWarn.apply(console, args);
    };
}

// ── Font Availability Warning ─────────────────────────────────────────

function checkFontAvailability(): void {
    const fontName = RTL_FONT_FAMILY.split(',')[0].trim();
    if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
            if (!document.fonts.check('16px ' + fontName)) {
                console.warn(
                    `[RTL Engine] Font "${fontName}" was not found. ` +
                    'Arabic text will fall back to sans-serif. ' +
                    'Install the font or change the Copilot RTL font setting.'
                );
            }
        });
    }
}

// ── MutationObserver ──────────────────────────────────────────────────

function startObserver(): void {
    if (_observer) { _observer.disconnect(); _observer = null; }

    const debouncedScan = debounce(() => {
        scanAll();
        processNonCodeMonacos(fontConfig, cursorConfig);
        observeSelectionLayers();
    }, 150);

    _observer = new MutationObserver(() => {
        debouncedScan();
        scheduleStabilize();
    });

    _observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    scanAll();
}

// ── Lexical input listener ────────────────────────────────────────────

function setupLexicalInputListener(): void {
    document.addEventListener('input', (e: Event) => {
        const target = e.target as Element;
        if (target?.closest?.('[data-lexical-editor="true"]')) {
            scanLexicalInputs(renderConfig);
        }
    }, true);
}

// ── Lifecycle: Shutdown & Reinitialize ─────────────────────────────────

function shutdown(): void {
    _enabled = false;
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_mainInterval) { clearInterval(_mainInterval); _mainInterval = null; }
    removeStyles();
    removeAllClasses();
    clearStickyState();
    restoreAllFonts();
    destroyCursorEngine();
    destroySelectionEngine();

    // Clean per-line direction attributes
    document.querySelectorAll('[data-rtl-dir]').forEach(el => {
        (el as HTMLElement).style.direction = '';
        (el as HTMLElement).style.textAlign = '';
        (el as HTMLElement).style.unicodeBidi = '';
        el.removeAttribute('data-rtl-dir');
    });
}

function reinitialize(): void {
    _enabled = true;
    injectStyles(renderConfig);
    startObserver();
    if (_mainInterval) clearInterval(_mainInterval);
    _mainInterval = setInterval(() => {
        scanAll();
        processNonCodeMonacos(fontConfig, cursorConfig);
        scanLexicalInputs(renderConfig);
        observeSelectionLayers();
        forceRemeasureAll(); // re-sync charWidth after Monaco DOM re-renders
    }, 3000);
    scanAll();
    processNonCodeMonacos(fontConfig, cursorConfig);
    scanLexicalInputs(renderConfig);
}

// ── State file polling (live toggle without reload) ───────────────────

function startStatePolling(): void {
    setInterval(() => {
        fetch('./copilot-rtl-state.json?t=' + Date.now(), { cache: 'no-store' })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then((data: any) => {
                const nowEnabled = data.enabled !== false;
                if (!nowEnabled && _enabled) shutdown();
                else if (nowEnabled && !_enabled) reinitialize();
            })
            .catch(() => {});
    }, 1500);
}

// ── DEBUG: Flicker spy ────────────────────────────────────────────────
// Watches Monaco editors for ANY style/class/attribute change and logs
// the source. Check DevTools console for [FLICKER-SPY] entries.

function startFlickerSpy(): void {
    const spy = new MutationObserver((mutations) => {
        for (const m of mutations) {
            const el = m.target as HTMLElement;
            if (!el.closest || !el.closest('.monaco-editor')) continue;

            // Watch for class changes on monaco-editor (EDITOR_RTL toggle)
            if (m.type === 'attributes' && m.attributeName === 'class') {
                const classes = el.classList.toString();
                if (el.classList.contains('monaco-editor') || el.classList.contains('view-line')) {
                    console.log(`[FLICKER-SPY] class changed on <${el.tagName}.${el.className.split(' ').slice(0, 3).join('.')}> → "${classes.substring(0, 100)}"`, new Error().stack?.split('\n').slice(1, 4).join(' | '));
                }
            }

            // Watch for style changes (font-family, font-size, direction)
            if (m.type === 'attributes' && m.attributeName === 'style') {
                const tag = el.tagName.toLowerCase();
                const style = el.style;
                if (tag === 'div' && (el.classList.contains('view-line') || el.classList.contains('view-lines') || el.classList.contains('lines-content'))) {
                    const ff = style.fontFamily;
                    const fs = style.fontSize;
                    const dir = style.direction;
                    if (ff || fs || dir) {
                        console.log(`[FLICKER-SPY] style on <${tag}.${el.className.split(' ')[0]}> → font:${ff || '-'} size:${fs || '-'} dir:${dir || '-'}`);
                    }
                }
            }

            // Watch for child additions (Monaco recreating view-lines)
            if (m.type === 'childList' && m.addedNodes.length > 0) {
                for (let i = 0; i < m.addedNodes.length; i++) {
                    const node = m.addedNodes[i] as HTMLElement;
                    if (node.nodeType === 1 && node.classList?.contains('view-line')) {
                        console.log(`[FLICKER-SPY] NEW view-line added (Monaco re-render)`, node.textContent?.substring(0, 50));
                    }
                }
            }
        }
    });

    // Start observing after a delay to skip initial render
    setTimeout(() => {
        spy.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style'],
            childList: true,
        });
        console.log('[FLICKER-SPY] Active — watching for style/class changes on Monaco editors');
    }, 3000);
}

// ── BOOT ──────────────────────────────────────────────────────────────

function boot(): void {
    console.log(`[RTL Engine] v${EXT_VERSION} loaded ✓ (per-line direction)`);
    document.documentElement.setAttribute('data-copilot-rtl', EXT_VERSION);

    suppressKatexWarnings();
    checkFontAvailability();
    injectStyles(renderConfig);
    startObserver();

    setupLexicalInputListener();
    setupInputListeners(fontConfig, cursorConfig);
    attachKeyboardInterceptor();
    preventDirectionToggle();

    onMonacoReady(() => {
        console.log('[RTL Engine] Monaco ready — initial scan');
        processNonCodeMonacos(fontConfig, cursorConfig);
        observeSelectionLayers();
    });

    _mainInterval = setInterval(() => {
        scanAll();
        processNonCodeMonacos(fontConfig, cursorConfig);
        scanLexicalInputs(renderConfig);
        observeSelectionLayers();
        forceRemeasureAll(); // re-sync charWidth after Monaco DOM re-renders
    }, 3000);

    processNonCodeMonacos(fontConfig, cursorConfig);
    scanLexicalInputs(renderConfig);

    startStatePolling();

    // DEBUG: Start the flicker spy
    startFlickerSpy();
}

// ── Entry Point ───────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
