export type Dict = Readonly<Record<string, string>>;
export type Params = Readonly<Record<string, string | number>>;

let dict: Dict = {};
let debugMissing = false;

/** Загружает словарь (public/i18n/<lang>.json). debug — подсвечивать отсутствующие ключи как [[key]]. */
export function setStrings(strings: Dict, opts: { debug?: boolean } = {}): void {
  dict = strings;
  debugMissing = opts.debug ?? false;
}

export function hasString(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(dict, key);
}

/** Строка интерфейса по ключу с подстановками {name}: t('hud.day', { n: 3 }). */
export function t(key: string, params?: Params): string {
  const raw = dict[key];
  if (raw === undefined) return debugMissing ? `[[${key}]]` : key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined ? m : String(v);
  });
}
