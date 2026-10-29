package com.carmori.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.car.app.connection.CarConnection;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.Observer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * Tells the web app when the phone is projecting to Android Auto, and reads text aloud as a
 * navigation-style prompt so it plays through the car speakers and ducks music.
 * Connection updates only arrive while the app process is running.
 */
@CapacitorPlugin(name = "CarConnection")
public class CarConnectionPlugin extends Plugin {

    private static final String UTTERANCE_ID = "carmori-briefing";
    private final Handler main = new Handler(Looper.getMainLooper());
    private LiveData<Integer> connectionType;
    private Observer<Integer> connectionObserver;
    private boolean connected = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private PluginCall pendingSpeech;
    private AudioFocusRequest focusRequest;

    @Override
    public void load() {
        main.post(() -> {
            connectionType = new CarConnection(getContext()).getType();
            connectionObserver = (type) -> {
                boolean now = type != null && type == CarConnection.CONNECTION_TYPE_PROJECTION;
                if (now == connected) return;
                connected = now;
                notifyListeners("carConnectionChange", state(), true);
            };
            connectionType.observeForever(connectionObserver);
        });
        tts = new TextToSpeech(getContext(), (status) -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) return;
            tts.setLanguage(Locale.US);
            tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { main.post(() -> speechEnded()); }
            @Override public void onError(String id) { main.post(() -> speechEnded()); }
            @Override public void onStop(String id, boolean interrupted) { main.post(() -> speechEnded()); }
        });
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("connected", connected);
        result.put("kind", connected ? "android_auto" : null);
        return result;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        if (!ttsReady) {
            call.reject("Speech is not ready yet");
            return;
        }
        main.post(() -> {
            if (pendingSpeech != null) pendingSpeech.resolve();
            pendingSpeech = call;
            String lang = call.getString("lang", "en-US");
            tts.setLanguage(Locale.forLanguageTag(lang));
            requestFocus();
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), UTTERANCE_ID);
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        main.post(() -> {
            if (tts != null) tts.stop();
            speechEnded();
            call.resolve();
        });
    }

    private void requestFocus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build())
            .build();
        audio.requestAudioFocus(focusRequest);
    }

    private void speechEnded() {
        if (pendingSpeech != null) {
            pendingSpeech.resolve();
            pendingSpeech = null;
        }
        if (focusRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (connectionType != null && connectionObserver != null) {
            connectionType.removeObserver(connectionObserver);
        }
        if (tts != null) tts.shutdown();
    }
}
