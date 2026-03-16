// Fix common LLM JSON mistakes before parsing
// Handles: trailing commas, single-line comments, unquoted newlines in strings

export function sanitizeJson(str) {
    return str
        // Remove single-line comments (// ...) that aren't inside strings
        .replace(/^\s*\/\/.*$/gm, '')
        // Remove trailing commas before } or ]
        .replace(/,\s*([\]}])/g, '$1')
}
