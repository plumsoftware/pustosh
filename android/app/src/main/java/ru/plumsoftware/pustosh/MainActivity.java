package ru.plumsoftware.pustosh;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

/** pustosh-immersive: создаётся tools/patch-android.ts — руками не править. */
public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("unchecked")
    public void onCreate(Bundle savedInstanceState) {
        // Реклама РСЯ есть только во флейворе ruStore — плагин подключается, если он в сборке.
        try {
            registerPlugin((Class<? extends Plugin>) Class.forName("ru.plumsoftware.pustosh.YandexAdsPlugin"));
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
