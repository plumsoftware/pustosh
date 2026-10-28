import type { CapacitorConfig } from '@capacitor/cli';

// appId — временный, окончательный выбирает владелец (ТЗ шаг 1.6: ru.<владелец>.pustosh).
const config: CapacitorConfig = {
  appId: 'ru.pustosh.game',
  appName: 'Пустошь',
  webDir: 'dist-android',
  android: {
    // Без отладки WebView в релизе; в debug-сборке Capacitor включает её сам.
    webContentsDebuggingEnabled: undefined,
    backgroundColor: '#000000',
  },
  plugins: {
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
