/**
 * Настройки Android-оболочки Capacitor (шаг 1.6), применяются повторно без вреда:
 *  - создаёт android/ через `cap add android`, если его нет;
 *  - AndroidManifest: альбомная ориентация sensorLandscape, аппаратное ускорение;
 *  - тема: полный экран без строки состояния и заголовка;
 *  - MainActivity: immersive sticky — скрыты строка состояния и нижняя панель навигации
 *    (свайп от края показывает их ненадолго), повторно — после сворачивания и при возврате фокуса;
 *  - подпись: dev-ключ keystore/dev.keystore для release, либо RELEASE_* из ~/.gradle/gradle.properties;
 *  - флейворы магазинов (ruStore, huaweiAppGallery, googlePlay) с id рекламы в BuildConfig; реклама РСЯ
 *    (Yandex Mobile Ads SDK + плагин YandexAds из tools/android) — только во флейворе ruStore.
 * Остальные правки android/ — только через плагины и capacitor.config.ts.
 */
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANDROID = join(ROOT, 'android');
/** appId из capacitor.config.ts — пакет MainActivity. */
const APP_ID = /appId:\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8'))![1]!;

if (!existsSync(join(ANDROID, 'app'))) {
  console.log('patch-android: android/ нет — npx cap add android');
  execSync('npx cap add android', { cwd: ROOT, stdio: 'inherit' });
}

function patch(rel: string, fn: (s: string) => string): void {
  const p = join(ANDROID, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(p, after);
    console.log(`patch-android: ${rel} обновлён`);
  }
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`${name}="[^"]*"`);
  return re.test(tag)
    ? tag.replace(re, `${name}="${value}"`)
    : tag.replace(/(<\w+)/, `$1\n        ${name}="${value}"`);
}

patch('app/src/main/AndroidManifest.xml', (s) => {
  s = s.replace(/<activity[\s\S]*?>/, (tag) => {
    tag = setAttr(tag, 'android:screenOrientation', 'sensorLandscape');
    tag = setAttr(tag, 'android:hardwareAccelerated', 'true');
    return tag;
  });
  s = s.replace(/<application[\s\S]*?>/, (tag) => setAttr(tag, 'android:hardwareAccelerated', 'true'));
  return s;
});

patch('app/src/main/res/values/styles.xml', (s) => {
  const items = [
    '<item name="android:windowFullscreen">true</item>',
    '<item name="android:windowContentOverlay">@null</item>',
    '<item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>',
  ];
  return s.replace(
    /(<style name="AppTheme\.NoActionBar"[^>]*>)([\s\S]*?)(<\/style>)/,
    (_m, open: string, body: string, close: string) => {
      for (const it of items) if (!body.includes(it.split('>')[0]!)) body += `    ${it}\n    `;
      return open + body + close;
    },
  );
});

const SIGN_MARK = '// pustosh-signing';
patch('app/build.gradle', (s) => {
  if (s.includes(SIGN_MARK)) return s;
  const block = `
    ${SIGN_MARK}: релизный ключ — RELEASE_* в ~/.gradle/gradle.properties, иначе dev-ключ (только для тестов)
    signingConfigs {
        release {
            if (project.hasProperty('RELEASE_STORE_FILE')) {
                storeFile file(RELEASE_STORE_FILE)
                storePassword RELEASE_STORE_PASSWORD
                keyAlias RELEASE_KEY_ALIAS
                keyPassword RELEASE_KEY_PASSWORD
            } else {
                storeFile rootProject.file('../keystore/dev.keystore')
                storePassword 'pustosh-dev'
                keyAlias 'dev'
                keyPassword 'pustosh-dev'
            }
        }
    }
`;
  s = s.replace(/(android\s*\{)/, `$1${block}`);
  s = s.replace(/(buildTypes\s*\{\s*release\s*\{)/, `$1\n            signingConfig signingConfigs.release`);
  return s;
});

/**
 * Флейворы магазинов. Реклама РСЯ: BuildConfig.ADS_INTERSTITIAL_ID / ADS_REWARDED_ID (пусто — рекламы
 * нет); в debug плагин берёт демо-блоки. SDK и плагин — только в ruStore (ruStoreImplementation).
 */
const ADS = {
  ruStore: { interstitial: 'R-M-20301995-1', rewarded: 'R-M-20301995-2' },
  huaweiAppGallery: { interstitial: '', rewarded: '' },
  googlePlay: { interstitial: '', rewarded: '' },
};
const YANDEX_ADS_SDK = 'com.yandex.android:mobileads:8.6.0';
const FLAVORS_MARK = '// pustosh-flavors';
patch('app/build.gradle', (s) => {
  // Блок генерируется заново (id могли поменяться): старый — от метки до её конца.
  s = s.replace(new RegExp(`\\n    ${FLAVORS_MARK}[\\s\\S]*?    ${FLAVORS_MARK}-end\\n`), '');
  const flavors = Object.entries(ADS)
    .map(
      ([name, id]) => `        ${name} {
            dimension 'store'
            buildConfigField 'String', 'ADS_INTERSTITIAL_ID', '"${id.interstitial}"'
            buildConfigField 'String', 'ADS_REWARDED_ID', '"${id.rewarded}"'
        }`,
    )
    .join('\n');
  const block = `
    ${FLAVORS_MARK}: магазины; реклама РСЯ — id в BuildConfig (пусто — без рекламы), в debug — демо-блоки
    buildFeatures {
        buildConfig true
    }
    flavorDimensions = ['store']
    productFlavors {
${flavors}
    }
    ${FLAVORS_MARK}-end
`;
  s = s.replace(/(android\s*\{)/, `$1${block}`);
  const dep = `    ruStoreImplementation '${YANDEX_ADS_SDK}' ${FLAVORS_MARK}`;
  s = s.replace(new RegExp(`\\n.*${FLAVORS_MARK}\\n`), '\n');
  s = s.replace(/(dependencies\s*\{\n)/, `$1${dep}\n`);
  return s;
});

// Плагин рекламы РСЯ — в исходники флейвора ruStore (в других сборках SDK нет).
{
  const dir = join(ANDROID, 'app/src/ruStore/java', APP_ID.replace(/\./g, '/'));
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(join(ROOT, 'tools/android/YandexAdsPlugin.java'), 'utf8').replace('__PACKAGE__', APP_ID);
  const dst = join(dir, 'YandexAdsPlugin.java');
  if (!existsSync(dst) || readFileSync(dst, 'utf8') !== src) {
    writeFileSync(dst, src);
    console.log('patch-android: плагин YandexAds (ruStore) обновлён');
  }
}

// Полноэкранный режим: панель навигации и строка состояния скрыты (свайп от края — показать на время).
const IMMERSIVE_MARK = 'pustosh-immersive';
const activityRel = `app/src/main/java/${APP_ID.replace(/\./g, '/')}/MainActivity.java`;
patch(activityRel, () => {
  return `package ${APP_ID};

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

/** ${IMMERSIVE_MARK}: создаётся tools/patch-android.ts — руками не править. */
public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("unchecked")
    public void onCreate(Bundle savedInstanceState) {
        // Реклама РСЯ есть только во флейворе ruStore — плагин подключается, если он в сборке.
        try {
            registerPlugin((Class<? extends Plugin>) Class.forName("${APP_ID}.YandexAdsPlugin"));
        } catch (ClassNotFoundException ignored) {
        }
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
`;
});

// Иконки и заставка из листа бренда (npm run brand → art_extra/brand/android): mipmap-* и drawable-*.
const BRAND = join(ROOT, 'art_extra', 'brand', 'android');
if (existsSync(BRAND)) {
  const res = join(ANDROID, 'app/src/main/res');
  for (const dir of readdirSync(BRAND)) {
    const src = join(BRAND, dir);
    if (!statSync(src).isDirectory()) continue;
    mkdirSync(join(res, dir), { recursive: true });
    for (const f of readdirSync(src)) copyFileSync(join(src, f), join(res, dir, f));
  }
  // Фон адаптивной иконки — тёмная ржавчина под эмблему.
  patch('app/src/main/res/values/ic_launcher_background.xml', (s) =>
    s.replace(
      /<color name="ic_launcher_background">#[0-9A-Fa-f]+<\/color>/,
      '<color name="ic_launcher_background">#2B1D12</color>',
    ),
  );
  console.log('patch-android: иконки и заставка из art_extra/brand/android');
}
