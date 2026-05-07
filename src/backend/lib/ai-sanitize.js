/**
 * Defensive helpers for user-controlled text that flows into LLM prompts.
 *
 * We cannot fully prevent prompt injection — at the end of the day an LLM
 * sees everything in its context as instructions. But a few cheap steps
 * drastically reduce accidental or low-effort attacks via display_name,
 * profile_text, memo_text, transcript, and free-form instruction fields:
 *
 *   1. Hard length caps, so a single user cannot flood the prompt.
 *   2. Control-character stripping.
 *   3. Neutralise obvious prompt delimiters that might close our framing
 *      (backticks runs, angle-tagged SYSTEM markers, triple dashes, etc).
 *   4. Escape standalone 'system:' / 'assistant:' role headers.
 */

const DEFAULTS = {
    displayName: 64,
    profileText: 800,
    memoText: 2000,
    transcript: 4000,
    instruction: 2000,
    generic: 4000
};

function stripControlChars(value) {
    return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function neutraliseMarkers(value) {
    return String(value || '')
        // Avoid ``` fences inside the user text ending our code blocks.
        .replace(/`{3,}/g, (run) => '\u200b'.repeat(Math.min(run.length, 6)))
        // <|system|> / <|user|> and similar model-specific control tokens.
        .replace(/<\|[^|>]{1,40}\|>/g, '')
        // "system:" or "assistant:" at start of a line (case-insensitive).
        .replace(/^\s*(system|assistant|user)\s*:/gim, '[$1]:');
}

function sanitize(value, limit) {
    if (value == null) return '';
    const trimmed = stripControlChars(String(value)).trim();
    const bounded = trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
    return neutraliseMarkers(bounded);
}

function sanitizeDisplayName(value) {
    return sanitize(value, DEFAULTS.displayName);
}

function sanitizeProfileText(value) {
    return sanitize(value, DEFAULTS.profileText);
}

function sanitizeMemoText(value) {
    return sanitize(value, DEFAULTS.memoText);
}

function sanitizeTranscript(value) {
    return sanitize(value, DEFAULTS.transcript);
}

function sanitizeInstruction(value) {
    return sanitize(value, DEFAULTS.instruction);
}

function sanitizeGeneric(value, limit = DEFAULTS.generic) {
    return sanitize(value, limit);
}

module.exports = {
    DEFAULTS,
    sanitize,
    sanitizeDisplayName,
    sanitizeProfileText,
    sanitizeMemoText,
    sanitizeTranscript,
    sanitizeInstruction,
    sanitizeGeneric
};
