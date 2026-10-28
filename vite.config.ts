import { defineConfig, type Plugin } from 'vitest/config';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLATFORMS = ['dev', 'yandex', 'android'] as const;
type Platform = (typeof PLATFORMS)[number];

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Яндекс требует подключать SDK по абсолютному пути /sdk.js до скрипта игры. */
function yandexSdkPlugin(platform: Platform): Plugin {
  return {
    name: 'pustosh-yandex-sdk',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tag = platform === 'yandex' ? '<script src="/sdk.js"></script>' : '';
        return html.replace('<!-- YANDEX_SDK -->', tag);
      },
    },
  };
}

/** Служебный кэш упаковщика атласов не нужен в сборке. */
function dropPackCachePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pustosh-drop-pack-cache',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const p = join(outDir, 'atlases/.cache.json');
      if (existsSync(p)) rmSync(p);
    },
  };
}

/**
 * Только для `npm run dev`: редактор рига (F6) сохраняет калибровку прямо в проект —
 * public/data/rigs_tuned/<id>.json и список public/data/rigs_tuned/index.json.
 */
function rigSavePlugin(): Plugin {
  return {
    name: 'pustosh-rig-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__rig/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString('utf8')));
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { id?: unknown };
            const id = String(data.id ?? '');
            if (!/^[a-z0-9_]+$/.test(id)) throw new Error('bad id');
            const dir = join(server.config.root, 'public/data/rigs_tuned');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${id}.json`), JSON.stringify(data, null, 1) + '\n');
            const indexPath = join(dir, 'index.json');
            const index = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as { rigs: string[] }) : { rigs: [] };
            if (!index.rigs.includes(id)) index.rigs.push(id);
            index.rigs.sort();
            writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: `public/data/rigs_tuned/${id}.json` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // vitest запускается в режиме 'test' — для него платформа dev.
  const platform: Platform = (PLATFORMS as readonly string[]).includes(mode) ? (mode as Platform) : 'dev';
  return {
    base: './',
    plugins: [yandexSdkPlugin(platform), dropPackCachePlugin(), rigSavePlugin()],
    define: {
      'import.meta.env.VITE_PLATFORM': JSON.stringify(platform),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1600,
      rolldownOptions: {
        output: {
          manualChunks(id: string) {
            return id.includes('node_modules/phaser') ? 'phaser' : undefined;
          },
        },
      },
    },
    server: { port: 5173 },
    test: {
      include: ['tests/**/*.test.ts', 'src/core/**/*.test.ts'],
      environment: 'node',
    },
  };
});
