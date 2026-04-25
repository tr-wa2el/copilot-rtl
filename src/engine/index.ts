/**
 * RTL Engine — Lifecycle Manager (Layer 8)
 * Main entry point for the injected script.
 * Orchestrates all engine layers: initialization, observation, and teardown.
 *
 * This file is bundled by esbuild into an IIFE and injected into workbench.html.
 */

import { debounce } from './utils';
import { onMonacoReady } from './monaco-bridge';
import {
    injectStyles, removeStyles, removeAllClasses,
    scanAllMarkdown, scanResponseContainers, scanLexicalInputs,
    type RenderConfig,
} from './rendering-patcher';
import { processNonCodeMonacos, setupInputListeners } from './direction-manager';
import { restoreAllFonts } from './font-metrics';
import { destroyCursorEngine, hideGhostCursor } from './cursor-engine';
import { observeSelectionLayers, destroySelectionEngine } from './selection-engine';
import { attachKeyboardInterceptor, fixInputAreaDirection, preventDirectionToggle } from './input-interceptor';
import type { FontConfig } from './font-metrics';
import type { CursorConfig } from './cursor-engine';

// ── Configuration ─────────────────────────────────────────────────────
// These are injected as global `var` declarations by extension.ts at write time.
// @ts-ignore — injected by build
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
        fixInputAreaDirection();
    }, 150);

    _observer = new MutationObserver(() => {
        debouncedScan();
        scheduleStabilize();
    });

    _observer.observe(document.body, {
        childList: true,
        subtree: true,
        // characterData intentionally excluded — every character streamed by
        // the AI fires a mutation, which was the main cause of flicker.
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
    restoreAllFonts();
    destroyCursorEngine();
    destroySelectionEngine();
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
        fixInputAreaDirection();
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

// ── BOOT ──────────────────────────────────────────────────────────────

function boot(): void {
    console.log(`[RTL Engine] v${EXT_VERSION} loaded ✓`);
    document.documentElement.setAttribute('data-copilot-rtl', EXT_VERSION);

    suppressKatexWarnings();
    checkFontAvailability();
    injectStyles(renderConfig);
    startObserver();

    // Phase 4: Input handling
    setupLexicalInputListener();
    setupInputListeners(fontConfig, cursorConfig);
    attachKeyboardInterceptor();
    preventDirectionToggle();

    // When Monaco is ready, do an initial scan of all editors
    onMonacoReady(() => {
        processNonCodeMonacos(fontConfig, cursorConfig);
        observeSelectionLayers();
        fixInputAreaDirection();
    });

    // Periodic fallback scan
    _mainInterval = setInterval(() => {
        scanAll();
        processNonCodeMonacos(fontConfig, cursorConfig);
        scanLexicalInputs(renderConfig);
        observeSelectionLayers();
        fixInputAreaDirection();
    }, 3000);

    // Initial scans
    processNonCodeMonacos(fontConfig, cursorConfig);
    scanLexicalInputs(renderConfig);
    fixInputAreaDirection();

    // Live toggle support
    startStatePolling();
}

// ── Entry Point ───────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
