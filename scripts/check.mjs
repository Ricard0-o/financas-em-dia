import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let count = 0;
function check(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','dados','demo'].includes(item.name)) continue;
    const file = join(dir,item.name);
    if (item.isDirectory()) check(file);
    else if (/\.(mjs|js)$/.test(item.name)) {
      const r = spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
      if (r.status !== 0) throw new Error(r.stderr);
      count++;
    }
  }
}
check(root); console.log(`${count} arquivos JavaScript verificados.`);
