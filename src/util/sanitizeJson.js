// the model sometimes hands back json with comments and trailing commas

export function sanitizeJson(str) {
    return str
        // whole-line comments only, a // inside a string is left alone
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/,\s*([\]}])/g, '$1')
}
