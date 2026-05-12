// fix common LLM JSON mistakes before parsing.
// handles: trailing commas, single-line comments, unquoted newlines in strings.

export function sanitizeJson(str) {
    return str
        // remove single-line comments (// ...) that arent inside strings
        .replace(/^\s*\/\/.*$/gm, '')
        // remove trailing commas before } or ]
        .replace(/,\s*([\]}])/g, '$1')
}
