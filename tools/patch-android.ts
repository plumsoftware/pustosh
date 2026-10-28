/**
 * Настройки Android-оболочки Capacitor (шаг 1.6), применяются повторно без вреда:
 *  - создаёт android/ через `cap add android`, если его нет;
 *  - AndroidManifest: альбомная ориентация sensorLandscape, аппаратное ускорение;
 *  - тема: полный экран без строки состояния и заголовка;
 *  - MainActivity: immersive sticky — скрыты строка состояния и нижняя панель навигации
 *    (свайп от края показывает их ненадолго), повторно — после сворачивания и при возврате фокуса;
 *  - подпись: dev-ключ keystore/dev.keystore для release, либо RELEASE_* из ~/.gradle/gradle.properties.
 * Остальные правки android/ — только через плагины и capacitor.config.ts.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANDROID = join(ROOT, 'android');

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

// Полноэкранный режим: панель навигации и строка состояния скрыты (свайп от края — показать на время).
const IMMERSIVE_MARK = 'pustosh-immersive';
const activityRel = 'app/src/main/java/ru/pustosh/game/MainActivity.java';
patch(activityRel, (s) => {
  if (s.includes(IMMERSIVE_MARK)) return s;
  return `package ru.pustosh.game;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/** ${IMMERSIVE_MARK}: создаётся tools/patch-android.ts — руками не править. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
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
