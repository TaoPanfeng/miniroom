import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);
// 只发布浏览器需要的文件，不把启动脚本、Git 元数据和测试发布到网页。
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'styles.css', '.nojekyll', 'src', 'vendor', 'assets']) {
  await cp(new URL(entry, root), new URL(entry, output), { recursive: true });
}
console.log(`Static site ready: ${fileURLToPath(output)}`);
