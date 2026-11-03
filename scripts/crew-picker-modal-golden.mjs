import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const path = fileURLToPath(new URL('../src/components/CrewTabBase.tsx', import.meta.url));
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0, 'CrewTabBase.tsx must parse as valid TSX');
let nestedForms = 0;
const visit = (node, formAncestor = false) => {
  const form = ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'form';
  if (form && formAncestor) nestedForms++;
  ts.forEachChild(node, child => visit(child, formAncestor || form));
};
visit(ast);
assert.equal(nestedForms, 0, 'Crew log must not contain nested HTML forms');
assert.match(source, /const confirmCustomName = \(\) => \{/);
assert.match(source, /<button type="button" onClick=\{confirmCustomName\}/);
assert.match(source, /if \(e\.key === 'Enter'\) \{\s*\/\/[^\n]*\n\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*confirmCustomName\(\);/);
assert.match(source, /<form data-hnl-pc-v3-form="crew-log" onSubmit=\{handleLogSubmit\}/);
console.log('Crew picker modal regression: PASS');
