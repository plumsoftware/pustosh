/** Минимальные типы SDK Яндекс Игр (только то, что используем). SDK подключается <script src="/sdk.js">. */
export interface YSDK {
  deviceInfo?: { type?: 'desktop' | 'mobile' | 'tablet' | 'tv' };
  environment?: { i18n?: { lang?: string } };
  features?: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  on?(event: 'game_api_pause' | 'game_api_resume', handler: () => void): void;
}

export interface YaGamesGlobal {
  init(): Promise<YSDK>;
}

declare global {
  interface Window {
    YaGames?: YaGamesGlobal;
  }
}
