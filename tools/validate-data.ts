/**
 * Валидация public/data/*.json теми же функциями, что и в игре (шаг 2.5).
 * Запуск: npm run validate-data. Код выхода 1 при ошибках.
 */
import { formatIssue, loadGameData } from '../src/core/data';
import { readAssetCatalog, readRawData } from './readGameFiles';

const assets = readAssetCatalog();
if (!assets)
  console.warn(
    'внимание: нет public/atlases/asset_index.json — картинки не проверяются (npm run pack-assets)',
  );

const { registry, errors, warnings } = loadGameData(readRawData(), assets);

for (const w of warnings) console.warn(formatIssue(w));
for (const e of errors) console.error(formatIssue(e));

if (registry) {
  console.log(
    `Данные: предметов ${registry.items.size}, рецептов ${registry.recipes.size}, станков ${registry.stations.size}, ` +
      `врагов ${registry.enemies.size}, боссов ${registry.bosses.size}, биомов ${registry.biomes.all.length}, ` +
      `защиты ${registry.defense.size}, машин ${registry.vehicles.size}.`,
  );
}
console.log(`Ошибок: ${errors.length}, предупреждений: ${warnings.length}.`);
process.exit(errors.length > 0 ? 1 : 0);
