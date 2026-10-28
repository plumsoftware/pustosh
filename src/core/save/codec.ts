import { GZ_PREFIX, type SaveCodec } from './SaveManager';

/**
 * gzip + base64 через стандартный CompressionStream (браузеры, Android WebView, Node 18+).
 * Если его нет — кодек не создаётся (сохранения пишутся простым JSON).
 */
export function gzipCodec(): SaveCodec | null {
  const g = globalThis as unknown as { CompressionStream?: unknown; DecompressionStream?: unknown };
  if (typeof g.CompressionStream !== 'function' || typeof g.DecompressionStream !== 'function') return null;
  return {
    async encode(json: string): Promise<string> {
      const bytes = await streamBytes(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')));
      return GZ_PREFIX + toBase64(bytes);
    },
    async decode(data: string): Promise<string> {
      const bytes = fromBase64(data.slice(GZ_PREFIX.length));
      const out = await streamBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
      return new TextDecoder().decode(out);
    },
  };
}

async function streamBytes(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const CHUNK = 0x8000;

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += CHUNK) s += String.fromCharCode(...b.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
