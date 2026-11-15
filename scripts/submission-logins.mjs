// Writes docs/SUBMISSION.local.md: docs/SUBMISSION.md with the DEV demo logins filled in.
// Reads only infra/.demo-users.dev.local.json (written by the dev deploy). Never prod. Both the
// input and the output are gitignored; nothing is printed.
import { readFileSync, writeFileSync } from 'node:fs';

const creds = JSON.parse(readFileSync('infra/.demo-users.dev.local.json', 'utf8'));
let doc = readFileSync('docs/SUBMISSION.md', 'utf8');
for (const id of ['student1', 'student2', 'faculty1', 'admin1']) {
  if (!creds[id]) throw new Error(`no dev login for ${id}; deploy dev first`);
  doc = doc.replaceAll(`<<${id}>>`, creds[id].password);
}
doc = doc.replace(/^> Paste-ready\.[\s\S]*?paste that one\.\n\n/m, '');
writeFileSync('docs/SUBMISSION.local.md', doc, { mode: 0o600 });
console.log('Wrote docs/SUBMISSION.local.md (dev demo logins filled in; not tracked by git).');
