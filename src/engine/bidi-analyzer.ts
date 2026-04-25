/**
 * RTL Engine — Bidi Analyzer (Layer 1)
 * Lightweight analysis of text directionality per line.
 * 
 * This is NOT a full UBA implementation — we rely on the browser for visual
 * reordering. This module just determines:
 * 1. Base paragraph direction (from first strong character)
 * 2. Whether a line has mixed direction content
 * 3. Run boundaries for selection rendering
 */

import { ARABIC_RE, BIDI_CONTROL_RE } from './constants';

export interface BidiLineInfo {
    baseDirection: 'ltr' | 'rtl';
    hasArabic: boolean;
    hasMixed: boolean;
    strongCharCount: { ltr: number; rtl: number };
}

// Strong LTR characters: Latin, Greek, Cyrillic, CJK, etc.
const STRONG_LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u4E00-\u9FFF]/;

// Strong RTL: Arabic, Hebrew, Thaana, Syriac
const STRONG_RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Analyze the bidi properties of a single line of text.
 */
export function analyzeLine(text: string): BidiLineInfo {
    // Strip bidi control characters for analysis
    const clean = text.replace(BIDI_CONTROL_RE, '');

    let firstStrongDir: 'ltr' | 'rtl' | null = null;
    let ltrCount = 0;
    let rtlCount = 0;

    for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (STRONG_RTL_RE.test(ch)) {
            rtlCount++;
            if (!firstStrongDir) firstStrongDir = 'rtl';
        } else if (STRONG_LTR_RE.test(ch)) {
            ltrCount++;
            if (!firstStrongDir) firstStrongDir = 'ltr';
        }
    }

    const hasArabic = ARABIC_RE.test(clean);
    const hasMixed = ltrCount > 0 && rtlCount > 0;

    return {
        baseDirection: firstStrongDir || 'ltr',
        hasArabic,
        hasMixed,
        strongCharCount: { ltr: ltrCount, rtl: rtlCount },
    };
}

/**
 * Get the dominant direction of text based on character count.
 * Useful for deciding overall editor direction when content changes.
 */
export function getDominantDirection(text: string): 'ltr' | 'rtl' {
    const info = analyzeLine(text);
    if (info.strongCharCount.rtl > info.strongCharCount.ltr) return 'rtl';
    return info.baseDirection;
}

/**
 * Check if text is purely RTL (no LTR strong characters except digits/punctuation).
 */
export function isPureRtl(text: string): boolean {
    const info = analyzeLine(text);
    return info.hasArabic && !info.hasMixed;
}

/**
 * Check if text is purely LTR (no RTL strong characters).
 */
export function isPureLtr(text: string): boolean {
    const info = analyzeLine(text);
    return !info.hasArabic && info.strongCharCount.ltr > 0;
}
