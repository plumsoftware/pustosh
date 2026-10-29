package ru.plumsoftware.pustosh;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;
import com.yandex.mobile.ads.rewarded.Reward;
import com.yandex.mobile.ads.rewarded.RewardedAd;
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoadListener;
import com.yandex.mobile.ads.rewarded.RewardedAdLoader;

/**
 * Реклама РСЯ (Yandex Mobile Ads SDK) для игры: межстраничная и с вознаграждением.
 * Блок загружается в момент показа (без предзагрузки) и сразу показывается.
 * Идентификаторы — BuildConfig.ADS_*_ID из флейвора (build.gradle); в debug — демо-блоки Яндекса.
 * Ответ JS: { result: "shown" | "rewarded" | "closed" | "unavailable" | "busy" | "error", message? }.
 *
 * Копируется tools/patch-android.ts в src/ruStore/java — руками не править.
 */
@CapacitorPlugin(name = "YandexAds")
public class YandexAdsPlugin extends Plugin {
    private static final String DEMO_INTERSTITIAL = "demo-interstitial-yandex";
    private static final String DEMO_REWARDED = "demo-rewarded-yandex";
    /** Сколько ждать загрузки блока, мс: дольше — ошибка, игра продолжается. */
    private static final long LOAD_TIMEOUT_MS = 10000;

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Загрузчик и показываемый блок держатся ссылкой, пока не закрыты (иначе их соберёт GC). */
    private Object loader;
    private Object ad;
    private boolean busy = false;

    @Override
    public void load() {
        if (unit(BuildConfig.ADS_INTERSTITIAL_ID, DEMO_INTERSTITIAL).isEmpty()
                && unit(BuildConfig.ADS_REWARDED_ID, DEMO_REWARDED).isEmpty()) return;
        YandexAds.initialize(getContext(), () -> {});
    }

    /** Блок флейвора; пустой — рекламы в этой сборке нет; в debug — демо-блок. */
    private static String unit(String release, String demo) {
        if (release == null || release.isEmpty()) return "";
        return BuildConfig.DEBUG ? demo : release;
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("interstitial", !unit(BuildConfig.ADS_INTERSTITIAL_ID, DEMO_INTERSTITIAL).isEmpty());
        r.put("rewarded", !unit(BuildConfig.ADS_REWARDED_ID, DEMO_REWARDED).isEmpty());
        r.put("demo", BuildConfig.DEBUG);
        call.resolve(r);
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        String id = unit(BuildConfig.ADS_INTERSTITIAL_ID, DEMO_INTERSTITIAL);
        if (!begin(call, id)) return;
        getActivity().runOnUiThread(() -> {
            InterstitialAdLoader l = new InterstitialAdLoader(getContext());
            loader = l;
            final boolean[] done = {false};
            Runnable timeout = () -> {
                if (done[0]) return;
                done[0] = true;
                l.cancelLoading();
                finish(call, "error", "timeout");
            };
            main.postDelayed(timeout, LOAD_TIMEOUT_MS);
            l.loadAd(new AdRequest.Builder(id).build(), new InterstitialAdLoadListener() {
                @Override
                public void onAdLoaded(InterstitialAd a) {
                    if (done[0]) return;
                    done[0] = true;
                    main.removeCallbacks(timeout);
                    ad = a;
                    a.setAdEventListener(new InterstitialAdEventListener() {
                        @Override public void onAdShown() {}
                        @Override public void onAdFailedToShow(AdError e) { finish(call, "error", e.getDescription()); }
                        @Override public void onAdDismissed() { finish(call, "shown", null); }
                        @Override public void onAdClicked() {}
                        @Override public void onAdImpression(ImpressionData d) {}
                    });
                    a.show(getActivity());
                }

                @Override
                public void onAdFailedToLoad(AdRequestError e) {
                    if (done[0]) return;
                    done[0] = true;
                    main.removeCallbacks(timeout);
                    finish(call, "error", e.getDescription());
                }
            });
        });
    }

    @PluginMethod
    public void showRewarded(PluginCall call) {
        String id = unit(BuildConfig.ADS_REWARDED_ID, DEMO_REWARDED);
        if (!begin(call, id)) return;
        getActivity().runOnUiThread(() -> {
            RewardedAdLoader l = new RewardedAdLoader(getContext());
            loader = l;
            final boolean[] done = {false};
            final boolean[] rewarded = {false};
            Runnable timeout = () -> {
                if (done[0]) return;
                done[0] = true;
                l.cancelLoading();
                finish(call, "error", "timeout");
            };
            main.postDelayed(timeout, LOAD_TIMEOUT_MS);
            l.loadAd(new AdRequest.Builder(id).build(), new RewardedAdLoadListener() {
                @Override
                public void onAdLoaded(RewardedAd a) {
                    if (done[0]) return;
                    done[0] = true;
                    main.removeCallbacks(timeout);
                    ad = a;
                    a.setAdEventListener(new RewardedAdEventListener() {
                        @Override public void onAdShown() {}
                        @Override public void onAdFailedToShow(AdError e) { finish(call, "error", e.getDescription()); }
                        @Override public void onAdDismissed() { finish(call, rewarded[0] ? "rewarded" : "closed", null); }
                        @Override public void onAdClicked() {}
                        @Override public void onAdImpression(ImpressionData d) {}
                        @Override public void onRewarded(Reward r) { rewarded[0] = true; }
                    });
                    a.show(getActivity());
                }

                @Override
                public void onAdFailedToLoad(AdRequestError e) {
                    if (done[0]) return;
                    done[0] = true;
                    main.removeCallbacks(timeout);
                    finish(call, "error", e.getDescription());
                }
            });
        });
    }

    /** Можно ли начать показ: блок есть, другой показ не идёт. Иначе — сразу ответ. */
    private boolean begin(PluginCall call, String id) {
        if (id.isEmpty()) {
            reply(call, "unavailable", null);
            return false;
        }
        if (busy) {
            reply(call, "busy", null);
            return false;
        }
        busy = true;
        return true;
    }

    private void finish(PluginCall call, String result, String message) {
        busy = false;
        loader = null;
        ad = null;
        reply(call, result, message);
    }

    private static void reply(PluginCall call, String result, String message) {
        JSObject r = new JSObject();
        r.put("result", result);
        if (message != null) r.put("message", message);
        call.resolve(r);
    }
}
