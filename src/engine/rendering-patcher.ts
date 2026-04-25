/**
 * RTL Engine — Rendering Patcher (Layer 7)
 * Handles CSS injection and per-element direction styling for chat responses
 * and Monaco inputs.
 */

import {
    CSS_CLASS, ELEMENT_ID, MD_CONTAINER_SELECTORS,
    RESPONSE_CONTAINER_SELECTORS, BLOCK_TAGS
} from './constants';
import { isArabicOrMixed } from './utils';

export interface RenderConfig {
    rtlFontFamily: string;
    rtlFontSize: string;
    rtlLineHeight: string;
    rtlTextAlign: string;
    ltrFontFamily: string;
    ltrFontSize: string;
    ltrLineHeight: string;
}

/** Apply per-block direction styles (direction, font, etc.) to elements inside a root. */
function markMixedTextBlocks(root: Element, config: RenderConfig): void {
    const blocks = root.querySelectorAll(BLOCK_TAGS.join(', '));
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i] as HTMLElement;
        if (block.tagName === 'PRE' || block.tagName === 'CODE') continue;
        if (block.closest('pre') || block.closest('code')) continue;

        if (isArabicOrMixed(block.textContent || '')) {
            block.style.setProperty('direction', 'rtl', 'important');
            block.style.setProperty('unicode-bidi', 'embed', 'important');
            block.style.setProperty('text-align', config.rtlTextAlign, 'important');
            block.style.setProperty('font-family', config.rtlFontFamily, 'important');
            block.style.setProperty('font-size', config.rtlFontSize, 'important');
            block.style.setProperty('line-height', config.rtlLineHeight, 'important');

            // KaTeX math inside Arabic paragraphs must stay LTR
            const katexEls = block.querySelectorAll('.katex, .katex-html');
            for (let k = 0; k < katexEls.length; k++) {
                (katexEls[k] as HTMLElement).style.setProperty('direction', 'ltr', 'important');
                (katexEls[k] as HTMLElement).style.setProperty('unicode-bidi', 'isolate', 'important');
                (katexEls[k] as HTMLElement).style.setProperty('text-align', 'left', 'important');
            }
        } else {
            block.style.setProperty('direction', 'ltr', 'important');
            block.style.setProperty('unicode-bidi', 'plaintext', 'important');
            block.style.setProperty('text-align', 'left', 'important');
        }
    }
}

/** Process a single markdown container (response/message). */
function processMarkdown(root: Element, isStreaming: boolean, config: RenderConfig): void {
    const rootArabic = isArabicOrMixed(root.textContent || '');

    if (rootArabic) {
        root.classList.add(CSS_CLASS.RESPONSE_RTL);
    } else {
        root.classList.remove(CSS_CLASS.RESPONSE_RTL);
    }

    markMixedTextBlocks(root, config);

    // Table cells need per-cell treatment but are deferred during streaming
    if (!isStreaming) {
        const cells = root.querySelectorAll('th, td');
        for (let t = 0; t < cells.length; t++) {
            const cell = cells[t] as HTMLElement;
            if (cell.tagName === 'PRE' || cell.tagName === 'CODE') continue;
            if (isArabicOrMixed(cell.textContent || '')) {
                cell.style.direction = 'rtl';
                cell.style.unicodeBidi = 'embed';
                cell.style.fontFamily = config.rtlFontFamily;
                cell.style.fontSize = config.rtlFontSize;
                cell.style.lineHeight = config.rtlLineHeight;
                cell.style.textAlign = config.rtlTextAlign;
            } else {
                cell.style.direction = 'ltr';
                cell.style.unicodeBidi = '';
                cell.style.fontFamily = config.ltrFontFamily;
                cell.style.fontSize = config.ltrFontSize;
                cell.style.lineHeight = config.ltrLineHeight;
                cell.style.textAlign = '';
            }
        }

        const tables = root.querySelectorAll('table');
        for (let tb = 0; tb < tables.length; tb++) {
            (tables[tb] as HTMLElement).style.direction =
                isArabicOrMixed(tables[tb].textContent || '') ? 'rtl' : 'ltr';
        }
    }
}

/** Scan all known markdown containers. */
export function scanAllMarkdown(isStreaming: boolean, config: RenderConfig): void {
    for (const sel of MD_CONTAINER_SELECTORS) {
        document.querySelectorAll(sel).forEach(el => processMarkdown(el, isStreaming, config));
    }
}

/** Scan Antigravity/Cursor response containers. */
export function scanResponseContainers(isStreaming: boolean, config: RenderConfig): void {
    for (const sel of RESPONSE_CONTAINER_SELECTORS) {
        document.querySelectorAll(sel).forEach((container) => {
            const containerArabic = isArabicOrMixed(container.textContent || '');
            if (containerArabic) {
                container.classList.add(CSS_CLASS.RESPONSE_RTL);
            } else {
                container.classList.remove(CSS_CLASS.RESPONSE_RTL);
            }
            markMixedTextBlocks(container, config);
        });
    }

    // User messages (skip code/pre and Lexical editors)
    document.querySelectorAll('.whitespace-pre-wrap, .whitespace-normal').forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.tagName === 'CODE' || htmlEl.tagName === 'PRE') return;
        if (htmlEl.closest('pre') || htmlEl.closest('code')) return;
        if (htmlEl.closest('[data-lexical-editor="true"]')) return;
        if (htmlEl.closest('.markdown-root')) return;

        if (isArabicOrMixed(htmlEl.textContent || '')) {
            htmlEl.style.direction = 'rtl';
            htmlEl.style.unicodeBidi = 'embed';
            htmlEl.style.fontFamily = config.rtlFontFamily;
            htmlEl.style.fontSize = config.rtlFontSize;
            htmlEl.style.lineHeight = config.rtlLineHeight;
            htmlEl.style.textAlign = config.rtlTextAlign;
        } else {
            htmlEl.style.direction = 'ltr';
            htmlEl.style.unicodeBidi = '';
            htmlEl.style.fontFamily = config.ltrFontFamily;
            htmlEl.style.fontSize = config.ltrFontSize;
            htmlEl.style.lineHeight = config.ltrLineHeight;
            htmlEl.style.textAlign = '';
        }
    });

    // Tables — only when not streaming
    if (!isStreaming) {
        const tableCellSel = RESPONSE_CONTAINER_SELECTORS.map(s => `${s} th, ${s} td`).join(', ');
        document.querySelectorAll(tableCellSel).forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (isArabicOrMixed(htmlEl.textContent || '')) {
                htmlEl.style.direction = 'rtl';
                htmlEl.style.fontFamily = config.rtlFontFamily;
                htmlEl.style.fontSize = config.rtlFontSize;
                htmlEl.style.lineHeight = config.rtlLineHeight;
            } else {
                htmlEl.style.direction = 'ltr';
            }
        });
    }
}

/** Scan Lexical input editors (Antigravity/Cursor input boxes). */
export function scanLexicalInputs(config: RenderConfig): void {
    document.querySelectorAll('[data-lexical-editor="true"]').forEach((editor) => {
        const htmlEditor = editor as HTMLElement;
        const text = htmlEditor.textContent || '';
        const arabic = isArabicOrMixed(text);

        htmlEditor.style.direction = '';
        htmlEditor.style.textAlign = '';

        if (arabic) {
            htmlEditor.classList.add(CSS_CLASS.LEXICAL_RTL);
            htmlEditor.style.setProperty('font-family', config.rtlFontFamily, 'important');
            htmlEditor.style.setProperty('font-size', config.rtlFontSize, 'important');
            htmlEditor.style.setProperty('line-height', config.rtlLineHeight, 'important');
        } else {
            htmlEditor.classList.remove(CSS_CLASS.LEXICAL_RTL);
            htmlEditor.style.removeProperty('font-family');
            htmlEditor.style.removeProperty('font-size');
            htmlEditor.style.removeProperty('line-height');
        }

        for (let i = 0; i < htmlEditor.children.length; i++) {
            const child = htmlEditor.children[i] as HTMLElement;
            const childArabic = isArabicOrMixed(child.textContent || '');
            child.style.direction = childArabic ? 'rtl' : (arabic ? 'rtl' : 'ltr');
            child.style.textAlign = childArabic ? config.rtlTextAlign : '';
            if (arabic) {
                child.style.setProperty('font-family', config.rtlFontFamily, 'important');
                child.style.setProperty('font-size', config.rtlFontSize, 'important');
                child.style.setProperty('line-height', config.rtlLineHeight, 'important');
            } else {
                child.style.removeProperty('font-family');
                child.style.removeProperty('font-size');
                child.style.removeProperty('line-height');
            }
        }
    });
}

// ── CSS Injection ─────────────────────────────────────────────────────

/** Inject the master CSS stylesheet for RTL support. */
export function injectStyles(config: RenderConfig): void {
    if (document.getElementById(ELEMENT_ID.STYLES)) return;

    const style = document.createElement('style');
    style.id = ELEMENT_ID.STYLES;
    let css = '';

    const ff = config.rtlFontFamily;
    const fs = config.rtlFontSize;
    const lh = config.rtlLineHeight;

    // ── Response containers (always-active CSS) ────────────────────
    const respTags = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'];
    const respCssSels: string[] = [];
    for (const c of RESPONSE_CONTAINER_SELECTORS) {
        for (const t of respTags) { respCssSels.push(`${c} ${t}`); }
    }
    css += `${respCssSels.join(', ')} { unicode-bidi: plaintext !important; text-align: right !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;

    // Spans in response containers
    const respSpanSels = RESPONSE_CONTAINER_SELECTORS.map(c => `${c} span`).join(', ');
    css += `${respSpanSels} { font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;

    // VS Code Copilot chat containers
    const mdSels = MD_CONTAINER_SELECTORS.map(s =>
        `${s} > p, ${s} > li, ${s} > h1, ${s} > h2, ${s} > h3, ${s} > h4, ${s} li, ${s} td, ${s} th`
    ).join(', ');
    css += `${mdSels} { unicode-bidi: plaintext !important; text-align: right !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;

    // Code blocks: ALWAYS LTR
    const codeSelectors = [
        ...RESPONSE_CONTAINER_SELECTORS.flatMap(c => [`${c} pre`, `${c} code`, `${c} pre span`, `${c} code span`]),
        ...MD_CONTAINER_SELECTORS.flatMap(s => [`${s} pre`, `${s} code`, `${s} .katex`, `${s} .katex-html`]),
    ];
    css += `${codeSelectors.join(', ')} { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; font-family: var(--vscode-editor-font-family, monospace) !important; font-size: var(--vscode-editor-font-size, 13px) !important; }`;

    // .copilot-rtl-response class (CSS-class approach)
    const rtlChildSels = BLOCK_TAGS.map(t => `.${CSS_CLASS.RESPONSE_RTL} ${t}`).join(', ');
    css += `.${CSS_CLASS.RESPONSE_RTL} { direction: rtl !important; }`;
    css += `${rtlChildSels} { direction: rtl !important; text-align: ${config.rtlTextAlign} !important; unicode-bidi: embed !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `.${CSS_CLASS.RESPONSE_RTL} pre, .${CSS_CLASS.RESPONSE_RTL} code, .${CSS_CLASS.RESPONSE_RTL} pre p, .${CSS_CLASS.RESPONSE_RTL} .katex, .${CSS_CLASS.RESPONSE_RTL} .katex-html { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; font-family: var(--vscode-editor-font-family, monospace) !important; font-size: var(--vscode-editor-font-size, 13px) !important; }`;

    // ── Monaco chat input RTL ─────────────────────────────────────
    const v2 = CSS_CLASS.EDITOR_RTL;
    css += `.${v2} .view-lines { unicode-bidi: plaintext !important; }`;
    css += `.${v2} .view-line { direction: rtl !important; text-align: right !important; }`;
    css += `.${v2} .native-edit-context { direction: rtl !important; unicode-bidi: plaintext !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `.${v2} .inputarea { direction: rtl !important; text-align: right !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `.${v2}.${CSS_CLASS.GHOST_ATTACHED} .cursor { visibility: hidden !important; }`;
    css += `#${ELEMENT_ID.GHOST_CURSOR} { position: fixed; width: 2px; background-color: var(--vscode-editorCursor-foreground, #007acc); pointer-events: none; z-index: 100000; transition: top 0.05s, left 0.05s; display: none; }`;
    css += `@keyframes copilot-rtl-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`;
    css += `#${ELEMENT_ID.GHOST_CURSOR}.blink { animation: copilot-rtl-blink 1s step-end infinite; }`;
    css += `.${v2} [class*="mtk"] { font-family: ${ff} !important; }`;
    css += `.${v2} .view-line span { font-family: ${ff} !important; }`;

    // Protect Monaco code views inside response containers
    const mdInlineCodeSels = MD_CONTAINER_SELECTORS.map(s =>
        `${s} .monaco-editor, ${s} .monaco-editor .view-line, ${s} .monaco-editor .view-lines`
    ).join(', ');
    css += `${mdInlineCodeSels} { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }`;
    css += `.${CSS_CLASS.RESPONSE_RTL} .monaco-editor, .${CSS_CLASS.RESPONSE_RTL} .monaco-editor .view-line, .${CSS_CLASS.RESPONSE_RTL} .monaco-editor .view-lines { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }`;
    css += `.leading-relaxed.select-text .monaco-editor, .leading-relaxed.select-text .monaco-editor .view-line { direction: ltr !important; text-align: left !important; unicode-bidi: isolate !important; }`;

    // Lexical input
    css += `[data-lexical-editor="true"].${CSS_CLASS.LEXICAL_RTL} { font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `[data-lexical-editor="true"].${CSS_CLASS.LEXICAL_RTL} > p { font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `[data-lexical-editor="true"].${CSS_CLASS.LEXICAL_RTL} span { font-family: ${ff} !important; font-size: ${fs} !important; }`;

    // Cursor user messages
    css += '.composer-human-message .min-w-0 { flex: 1 1 0% !important; width: 100% !important; }';
    css += '.composer-human-message [data-lexical-editor] { width: 100% !important; }';
    css += `.composer-human-message [data-lexical-editor] p, .aislash-editor-input-readonly p { unicode-bidi: plaintext !important; font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;
    css += `.composer-human-message [data-lexical-editor] span, .aislash-editor-input-readonly span { font-family: ${ff} !important; font-size: ${fs} !important; line-height: ${lh} !important; }`;

    // Selection overlay for RTL editors — hide Monaco's wrong selection, show ours
    css += `.${v2} .selected-text { opacity: 0.5 !important; }`;
    css += `#copilot-rtl-selection-overlay div { pointer-events: none; }`;

    // Find & Replace widget text alignment
    css += `.${v2} .find-widget .input { direction: rtl !important; text-align: right !important; }`;

    style.textContent = css;
    document.head.appendChild(style);
}

/** Remove injected styles. */
export function removeStyles(): void {
    const style = document.getElementById(ELEMENT_ID.STYLES);
    if (style?.parentNode) style.parentNode.removeChild(style);
}

/** Remove all RTL-related classes from the DOM. */
export function removeAllClasses(): void {
    document.querySelectorAll(`.${CSS_CLASS.RESPONSE_RTL}`).forEach(el =>
        el.classList.remove(CSS_CLASS.RESPONSE_RTL));
    document.querySelectorAll(`.${CSS_CLASS.EDITOR_RTL}`).forEach(el =>
        el.classList.remove(CSS_CLASS.EDITOR_RTL));
    document.querySelectorAll(`.${CSS_CLASS.LEXICAL_RTL}`).forEach(el =>
        el.classList.remove(CSS_CLASS.LEXICAL_RTL));
}
