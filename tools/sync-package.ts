/**
 * Копирует исходники из пакета ТЗ в проект (шаг 2.1):
 *   <пакет>/assets + assets_manifest.json → art/   (исходники, в сборку не попадают)
 *   <пакет>/data/*.json                  → public/data/
 * Пакет по умолчанию — «Pustosh_GameDev_Package 2»; другой путь — первым аргументом.
 * Перезаписывает art/ и public/data/ — после копирования проверьте diff и закоммитьте отдельно.
 */
import { cpSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = resolve(root, process.argv[2] ?? 'Pustosh_GameDev_Package 2');
if (!existsSync(join(pkg, 'assets_manifest.json'))) {
  console.error(`Не найден пакет: ${pkg}`);
  process.exit(1);
}

mkdirSync(join(root, 'art'), { recursive: true });
cpSync(join(pkg, 'assets'), join(root, 'art/assets'), { recursive: true });
cpSync(join(pkg, 'assets_manifest.json'), join(root, 'art/assets_manifest.json'));

mkdirSync(join(root, 'public/data'), { recursive: true });
const files = readdirSync(join(pkg, 'data')).filter((f) => f.endsWith('.json'));
for (const f of files) cpSync(join(pkg, 'data', f), join(root, 'public/data', f));
console.log(`art/ обновлён, public/data/: ${files.length} файлов`);
