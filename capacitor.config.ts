import type { CapacitorConfig } from '@capacitor/cli';

// appId выбран владельцем (ТЗ шаг 1.6: ru.<владелец>.pustosh). После публикации не менять.
const config: CapacitorConfig = {
  appId: 'ru.plumsoftware.pustosh',
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
