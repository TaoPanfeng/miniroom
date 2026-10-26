import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const errors = [];
const files = [];
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await collect(name);
    else if (/\.(?:js|mjs)$/.test(name)) files.push(name);
  }
}
for (const directory of ['src', 'vendor', 'scripts']) await collect(directory);
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (checked.status !== 0) errors.push(`${file}: ${checked.stderr}`);
}

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const importMapText = html.match(/<script\s+type="importmap"[^>]*>([\s\S]*?)<\/script>/)?.[1];
const imports = importMapText ? JSON.parse(importMapText).imports : {};
async function checkReference(reference, from) {
  if (/^(?:data:|#)/.test(reference)) return;
  if (/^(?:https?:|\/\/)/.test(reference)) {
    errors.push(`${from}: runtime resource must be local: ${reference}`);
    return;
  }
  const mapped = imports[reference];
  const target = mapped
    ? path.resolve(root, mapped)
    : path.resolve(root, path.dirname(from), reference.split(/[?#]/)[0]);
  if (!target.startsWith(root + path.sep)) errors.push(`${from}: invalid resource path ${reference}`);
  else {
    try { await access(target); }
    catch { errors.push(`${from}: missing resource ${reference}`); }
  }
}
for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
  await checkReference(match[1], 'index.html');
}
for (const reference of Object.values(imports)) await checkReference(reference, 'index.html');
for (const file of files.filter((name) => !name.startsWith('scripts/'))) {
  // 官方附加模块注释里含 npm 导入示例，不把注释当作实际依赖。
  const source = (await readFile(path.join(root, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of source.matchAll(/\b(?:from\s*|import\s*\()(['"])([^'"\n]+)\1/g)) {
    await checkReference(match[2], file);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Checked ${files.length} JavaScript files; all runtime imports and HTML resources are local and present.`);
