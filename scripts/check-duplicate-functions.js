const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'src', 'frontend');

function getFrontendFiles() {
    return fs.readdirSync(frontendDir)
        .filter((name) => name.endsWith('.js'))
        .sort()
        .map((name) => path.join(frontendDir, name));
}

function collectTopLevelFunctionDeclarations(source) {
    const names = new Set();
    const lines = source.split(/\r?\n/);
    let depth = 0;

    for (const line of lines) {
        if (depth === 0) {
            const match = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
            if (match) {
                names.add(match[1]);
            }
        }

        const sanitized = line
            .replace(/\/\/.*$/, '')
            .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '');

        for (const char of sanitized) {
            if (char === '{') depth += 1;
            if (char === '}') depth = Math.max(0, depth - 1);
        }
    }
    return names;
}

function collectWindowExports(source, functionNames) {
    const names = new Set();
    const exportBlockPattern = /window\.App[A-Za-z0-9_$]+\s*=\s*\{([\s\S]*?)\};/g;
    let blockMatch;
    while ((blockMatch = exportBlockPattern.exec(source))) {
        const body = blockMatch[1];
        const propertyPattern = /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*,?/g;
        let propertyMatch;
        while ((propertyMatch = propertyPattern.exec(body))) {
            const exportName = propertyMatch[1];
            const rhsName = propertyMatch[2] || exportName;
            if (functionNames.has(rhsName)) {
                names.add(exportName);
            }
        }
    }
    return names;
}

function main() {
    const definitions = new Map();

    for (const file of getFrontendFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        const fileLabel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        const functionNames = collectTopLevelFunctionDeclarations(source);
        const names = new Set([
            ...functionNames,
            ...collectWindowExports(source, functionNames)
        ]);

        for (const name of names) {
            if (!definitions.has(name)) {
                definitions.set(name, []);
            }
            definitions.get(name).push(fileLabel);
        }
    }

    const duplicates = [...definitions.entries()]
        .filter(([, files]) => files.length > 1)
        .sort(([left], [right]) => left.localeCompare(right));

    if (!duplicates.length) {
        console.log('No duplicate top-level/frontend export names found.');
        return;
    }

    console.error('Duplicate top-level/frontend export names found:');
    for (const [name, files] of duplicates) {
        console.error(`- ${name}: ${files.join(', ')}`);
    }
    process.exit(1);
}

main();
