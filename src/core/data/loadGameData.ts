import type { z } from 'zod';
import { Registry, type RegistrySource } from './Registry';
import { DATA_FILES, DATA_FILE_NAMES, PrefabDef, type DataFileName } from './schemas';
import { validateReferences, type AssetCatalog } from './validate';

export interface DataIssue {
  level: 'error' | 'warning';
  /** Где: 'recipes.json → r_axe_stone.inputs.stone' */
  where: string;
  message: string;
}

export interface GameData {
  /** null, если хотя бы один файл не прошёл схему. */
  registry: Registry | null;
  errors: DataIssue[];
  warnings: DataIssue[];
}

export function formatIssue(i: DataIssue): string {
  return `${i.level === 'error' ? 'ОШИБКА' : 'внимание'}: ${i.where}: ${i.message}`;
}

/** Человекочитаемый путь: индекс элемента массива заменяется его id, если он есть. */
function describePath(file: string, raw: unknown, path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  let node: unknown = raw;
  for (const key of path) {
    if (Array.isArray(node) && typeof key === 'number') {
      const el: unknown = node[key];
      const id = el && typeof el === 'object' && 'id' in el ? (el as { id: unknown }).id : undefined;
      parts.push(id !== undefined ? String(id) : `[${key}]`);
      node = el;
    } else {
      parts.push(String(key));
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[String(key)] : undefined;
    }
  }
  return `${file}.json → ${parts.join('.') || '(корень)'}`;
}

/**
 * Парсит все data/*.json, собирает Registry и проверяет перекрёстные ссылки.
 * core не знает, откуда пришли JSON: в игре их даёт PreloadScene, в тестах и валидаторе — чтение файлов.
 * assets — список спрайтов из asset_index.json; без него проверка картинок пропускается.
 */
export function loadGameData(raw: Readonly<Record<string, unknown>>, assets?: AssetCatalog): GameData {
  const errors: DataIssue[] = [];
  const warnings: DataIssue[] = [];
  const parsed: Partial<Record<DataFileName, unknown>> = {};

  for (const name of DATA_FILE_NAMES) {
    const input = raw[name];
    if (input === undefined) {
      errors.push({ level: 'error', where: `${name}.json`, message: 'файл не загружен' });
      continue;
    }
    const schema: z.ZodType = DATA_FILES[name];
    const res = schema.safeParse(input);
    if (res.success) {
      parsed[name] = res.data;
    } else {
      for (const issue of res.error.issues) {
        errors.push({ level: 'error', where: describePath(name, input, issue.path), message: issue.message });
      }
    }
  }

  // Префабы: raw.prefabs = { id: json } (файлы world/prefabs/<id>.json, список — в worldgen.json).
  const prefabs: Record<string, PrefabDef> = {};
  const rawPrefabs = (raw['prefabs'] ?? {}) as Record<string, unknown>;
  for (const id of prefabIdsOf(parsed.worldgen)) {
    const input = rawPrefabs[id];
    const file = `world/prefabs/${id}`;
    if (input === undefined) {
      errors.push({ level: 'error', where: `${file}.json`, message: 'файл префаба не загружен' });
      continue;
    }
    const res = PrefabDef.safeParse(input);
    if (!res.success) {
      for (const issue of res.error.issues)
        errors.push({ level: 'error', where: describePath(file, input, issue.path), message: issue.message });
    } else if (res.data.id !== id) {
      errors.push({
        level: 'error',
        where: `${file}.json → id`,
        message: `id «${res.data.id}» не совпадает с именем файла`,
      });
    } else prefabs[id] = res.data;
  }

  if (errors.length > 0) return { registry: null, errors, warnings };

  const registry = new Registry({ ...(parsed as unknown as Omit<RegistrySource, 'prefabs'>), prefabs });
  for (const issue of validateReferences(registry, raw, assets)) {
    (issue.level === 'error' ? errors : warnings).push(issue);
  }
  return { registry, errors, warnings };
}

/** id префабов, на которые ссылается worldgen.json. */
export function prefabIdsOf(worldgen: unknown): string[] {
  const w = worldgen as
    | {
        ruins?: { prefabs?: string[] };
        arenas?: { prefab?: string };
        gates?: { prefab?: string };
        bunker?: { prefab?: string };
      }
    | undefined;
  if (!w) return [];
  const ids = [...(w.ruins?.prefabs ?? []), w.arenas?.prefab, w.gates?.prefab, w.bunker?.prefab];
  return [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
}
