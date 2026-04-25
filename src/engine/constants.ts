/**
 * RTL Engine — Constants
 * Shared constants used across all engine layers.
 */

// Arabic Unicode blocks: Arabic, Arabic Supplement, Arabic Presentation Forms A & B
export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Unicode bidi control characters (invisible markers injected by Monaco/browser)
export const BIDI_CONTROL_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// CSS class names used by the engine
export const CSS_CLASS = {
    /** Applied to Monaco editors that are currently in RTL mode */
    EDITOR_RTL: 'copilot-rtl-v2',
    /** Applied to response containers with Arabic content */
    RESPONSE_RTL: 'copilot-rtl-response',
    /** Applied to Lexical editors with Arabic content */
    LEXICAL_RTL: 'copilot-rtl-lexical',
    /** Applied to Monaco editors when ghost cursor is active */
    GHOST_ATTACHED: 'ghost-cursor-attached',
} as const;

// Element IDs
export const ELEMENT_ID = {
    STYLES: 'copilot-rtl-styles',
    GHOST_CURSOR: 'copilot-rtl-ghost-cursor',
} as const;

// All known selectors for Copilot/chat markdown containers across VS Code versions
export const MD_CONTAINER_SELECTORS = [
    '.rendered-markdown',
    '.chat-response-rendered-markdown',
    '.monaco-chat-answer .markdown-body',
    '.markdown-body',
    '.chat-message-text',
    '.chat-response-list-item .rendered-markdown',
    '.interactive-response .rendered-markdown',
    '.copilot-chat-response .rendered-markdown',
    '.chat-tree-item-contents .rendered-markdown',
    '.chat-list-item-layout .rendered-markdown',
    // Cursor IDE chat containers
    '.markdown-root .space-y-4',
];

// Antigravity / Cursor response container selectors
export const RESPONSE_CONTAINER_SELECTORS = [
    '.leading-relaxed.select-text',
    '.markdown-root .space-y-4',
];

// Ancestors that identify a main code editor (NOT a chat input)
export const CODE_EDITOR_ANCESTORS = [
    '.editor-group-container',
    '.editor-instance',
    '.monaco-workbench .part.editor',
];

// Block-level elements that get per-block direction treatment
export const BLOCK_TAGS = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'] as const;

// Table cell tags
export const TABLE_CELL_TAGS = ['th', 'td'] as const;
