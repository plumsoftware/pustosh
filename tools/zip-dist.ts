/**
 * Архив веб-сборки для консоли Яндекс Игр: index.html в корне архива, без .map и служебных файлов.
 * Запуск: tsx tools/zip-dist.ts <папка> <архив.zip>
 */
import AdmZip from 'adm-zip';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const [dirArg, outArg] = process.argv.slice(2);
if (!dirArg || !outArg) {
  console.error('Использование: tsx tools/zip-dist.ts <папка> <архив.zip>');
  process.exit(1);
}
const dir = resolve(dirArg);
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`${dir}: нет index.html`);
  process.exit(1);
}

const zip = new AdmZip();
let files = 0;
let bytes = 0;
const walk = (d: string) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!name.startsWith('.') && !name.endsWith('.map')) {
      const rel = relative(dir, p);
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      zip.addLocalFile(p, parent);
      files++;
      bytes += statSync(p).size;
    }
  }
};
walk(dir);
zip.writeZip(resolve(outArg));
console.log(
  `${outArg}: ${files} файлов, ${(bytes / 1024 / 1024).toFixed(2)} МБ без сжатия, архив ${(statSync(resolve(outArg)).size / 1024 / 1024).toFixed(2)} МБ`,
);
