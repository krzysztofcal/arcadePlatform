package pl.kcswh.arcadepoker.stage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.SoundPool;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "PokerAudio")
public class PokerAudioPlugin extends Plugin {
    private static final String TAG = "PokerAudio";
    private static final float TARGET_GAIN = 0.35f;
    private static final Pattern CUE_PATTERN = Pattern.compile("^[a-z0-9_]{1,40}$");

    // State
    private boolean enabled = true;
    private boolean unlocked = false;
    private boolean resumed = false;
    private boolean musicScene = false;
    private boolean hold = false;
    private boolean focusPaused = false;
    private boolean ducked = false;
    private boolean focusHeld = false;

    // Concurrency / Lifecycle
    private Handler mainHandler;
    private boolean noisyReceiverRegistered = false;

    // Assets
    private final Map<String, String> assetFiles = new HashMap<>();

    // Music (MediaPlayer)
    private MediaPlayer mediaPlayer;
    private boolean mediaPlayerPrepared = false;
    private boolean mediaPlayerPreparing = false;
    private float currentVolume = 0.0f;
    private Runnable currentFade = null;
    private AudioFocusRequest audioFocusRequest = null;

    // Cues (SoundPool)
    private SoundPool soundPool;
    private final Map<String, Integer> cueToSoundId = new HashMap<>();
    private final Map<Integer, String> soundIdToCue = new HashMap<>();
    private final Set<Integer> loadedSoundIds = new HashSet<>();
    private final Set<Integer> activeStreams = new HashSet<>();
    private int lastVoiceStream = 0;
    private final Map<Integer, PendingCuePlay> pendingPlays = new HashMap<>();

    private static class PendingCuePlay {
        final String cue;
        final String channel;
        final long timestamp;
        final PluginCall call;

        PendingCuePlay(String cue, String channel, long timestamp, PluginCall call) {
            this.cue = cue;
            this.channel = channel;
            this.timestamp = timestamp;
            this.call = call;
        }
    }

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                runOnMain(() -> onBecomingNoisy());
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(int focusChange) {
            runOnMain(() -> handleAudioFocusChange(focusChange));
        }
    };

    @Override
    public void load() {
        super.load();
        mainHandler = new Handler(Looper.getMainLooper());
        runOnMain(() -> {
            try {
                SharedPreferences prefs = getContext().getSharedPreferences("poker_audio", Context.MODE_PRIVATE);
                enabled = prefs.getBoolean("sound_on", true);

                initAssetMap();

                IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    getContext().registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    getContext().registerReceiver(noisyReceiver, filter);
                }
                noisyReceiverRegistered = true;

                if (bridge != null) {
                    bridge.addWebViewListener(new WebViewListener() {
                        @Override
                        public void onPageCommitVisible(WebView view, String url) {
                            runOnMain(() -> {
                                if (url == null) return;
                                Uri page = Uri.parse(url);
                                boolean nextMusicScene = "https".equals(page.getScheme())
                                        && "localhost".equals(page.getHost())
                                        && ("/poker/index.html".equals(page.getPath())
                                        || "/poker/".equals(page.getPath())
                                        || "/account.html".equals(page.getPath()));
                                if (nextMusicScene != musicScene) {
                                    musicScene = nextMusicScene;
                                    sync(true);
                                }
                            });
                        }
                    });

                    WebView webView = bridge.getWebView();
                    if (webView != null && webView.getUrl() != null) {
                        Uri page = Uri.parse(webView.getUrl());
                        musicScene = "https".equals(page.getScheme())
                                && "localhost".equals(page.getHost())
                                && ("/poker/index.html".equals(page.getPath())
                                || "/poker/".equals(page.getPath())
                                || "/account.html".equals(page.getPath()));
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Initialization failed: " + e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnResume() {
        runOnMain(() -> {
            try {
                resumed = true;
                hold = false;
                sync(true);
            } catch (Exception e) {
                Log.w(TAG, "handleOnResume failed: " + e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnPause() {
        runOnMain(() -> {
            try {
                resumed = false;
                stopAllCues();
                sync(false);
            } catch (Exception e) {
                Log.w(TAG, "handleOnPause failed: " + e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        runOnMain(() -> {
            try {
                if (noisyReceiverRegistered) {
                    getContext().unregisterReceiver(noisyReceiver);
                    noisyReceiverRegistered = false;
                }
            } catch (Exception e) {
                Log.w(TAG, "Unregistering noisy receiver failed: " + e.getMessage());
            }
            abandonAudioFocus();
            releaseMediaPlayer();
            releaseSoundPool();
        });
    }

    private void runOnMain(Runnable runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                runnable.run();
            } catch (Exception e) {
                Log.w(TAG, "Execution error: " + e.getMessage());
            }
        } else if (mainHandler != null) {
            mainHandler.post(() -> {
                try {
                    runnable.run();
                } catch (Exception e) {
                    Log.w(TAG, "Execution error: " + e.getMessage());
                }
            });
        }
    }

    private boolean audible() {
        return enabled && unlocked && resumed && !hold && !focusPaused;
    }

    private void onBecomingNoisy() {
        hold = true;
        stopAllCues();
        sync(false);
    }

    private void handleAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_GAIN:
                focusHeld = true;
                focusPaused = false;
                ducked = false;
                sync(true);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                ducked = true;
                if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                    cancelFade();
                    currentVolume = TARGET_GAIN * 0.30f;
                    try {
                        mediaPlayer.setVolume(currentVolume, currentVolume);
                    } catch (Exception ignored) {}
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                focusPaused = true;
                stopAllCues();
                sync(false);
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                hold = true;
                focusHeld = false;
                stopAllCues();
                sync(false);
                break;
        }
    }

    private void initAssetMap() {
        try {
            String[] files = getContext().getAssets().list("public/mobile/audio");
            if (files != null) {
                for (String f : files) {
                    int dot = f.lastIndexOf('.');
                    String base = (dot > 0) ? f.substring(0, dot) : f;
                    assetFiles.put(base, f);
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "Failed listing assets: " + e.getMessage());
        }
    }

    private AudioManager getAudioManager() {
        try {
            return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        } catch (Exception e) {
            Log.w(TAG, "AudioManager unavailable: " + e.getMessage());
            return null;
        }
    }

    private boolean requestAudioFocus() {
        AudioManager am = getAudioManager();
        if (am == null) return false;
        try {
            int res;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_GAME)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build();
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                            .setAudioAttributes(attrs)
                            .setAcceptsDelayedFocusGain(false)
                            .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
                            .build();
                }
                res = am.requestAudioFocus(audioFocusRequest);
            } else {
                res = am.requestAudioFocus(audioFocusChangeListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
            focusHeld = (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
            return focusHeld;
        } catch (Exception e) {
            Log.w(TAG, "requestAudioFocus failed: " + e.getMessage());
            return false;
        }
    }

    private void abandonAudioFocus() {
        if (!focusHeld) return;
        AudioManager am = getAudioManager();
        if (am != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (audioFocusRequest != null) {
                        am.abandonAudioFocusRequest(audioFocusRequest);
                    }
                } else {
                    am.abandonAudioFocus(audioFocusChangeListener);
                }
            } catch (Exception e) {
                Log.w(TAG, "abandonAudioFocus failed: " + e.getMessage());
            }
        }
        focusHeld = false;
    }

    private void initMediaPlayer() {
        if (mediaPlayer != null || mediaPlayerPreparing) return;
        String fileName = assetFiles.get("lobby");
        if (fileName == null) {
            Log.w(TAG, "Lobby audio asset missing");
            return;
        }
        mediaPlayerPreparing = true;
        try {
            MediaPlayer mp = new MediaPlayer();
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();
            mp.setAudioAttributes(attrs);
            mp.setLooping(true);

            AssetFileDescriptor afd = getContext().getAssets().openFd("public/mobile/audio/" + fileName);
            mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();

            mp.setOnPreparedListener(p -> runOnMain(() -> {
                mediaPlayerPrepared = true;
                mediaPlayerPreparing = false;
                sync(true);
            }));

            mp.setOnErrorListener((p, what, extra) -> {
                Log.w(TAG, "MediaPlayer error: " + what + ", " + extra);
                runOnMain(() -> releaseMediaPlayer());
                return true;
            });

            mp.setVolume(0.0f, 0.0f);
            currentVolume = 0.0f;
            mp.prepareAsync();
            mediaPlayer = mp;
        } catch (Exception e) {
            Log.w(TAG, "initMediaPlayer failed: " + e.getMessage());
            mediaPlayerPreparing = false;
            releaseMediaPlayer();
        }
    }

    private void releaseMediaPlayer() {
        cancelFade();
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception e) {
                Log.w(TAG, "releaseMediaPlayer failed: " + e.getMessage());
            }
            mediaPlayer = null;
        }
        mediaPlayerPrepared = false;
        mediaPlayerPreparing = false;
        currentVolume = 0.0f;
    }

    private void cancelFade() {
        if (currentFade != null) {
            if (mainHandler != null) {
                mainHandler.removeCallbacks(currentFade);
            }
            currentFade = null;
        }
    }

    private void fadeVolumeTo(final float targetVol, final Runnable onComplete) {
        cancelFade();
        final float startVol = currentVolume;
        final float delta = targetVol - startVol;
        final int totalSteps = 12;
        final long stepInterval = 50L;

        if (Math.abs(delta) < 0.001f) {
            currentVolume = targetVol;
            if (mediaPlayer != null) {
                try {
                    mediaPlayer.setVolume(currentVolume, currentVolume);
                } catch (Exception ignored) {}
            }
            if (onComplete != null) onComplete.run();
            return;
        }

        currentFade = new Runnable() {
            int step = 0;

            @Override
            public void run() {
                step++;
                if (mediaPlayer == null) {
                    currentFade = null;
                    return;
                }
                if (step >= totalSteps) {
                    currentVolume = targetVol;
                    try {
                        mediaPlayer.setVolume(currentVolume, currentVolume);
                    } catch (Exception ignored) {}
                    currentFade = null;
                    if (onComplete != null) {
                        onComplete.run();
                    }
                } else {
                    currentVolume = startVol + delta * ((float) step / totalSteps);
                    try {
                        mediaPlayer.setVolume(currentVolume, currentVolume);
                    } catch (Exception ignored) {}
                    if (mainHandler != null) {
                        mainHandler.postDelayed(this, stepInterval);
                    }
                }
            }
        };
        if (mainHandler != null) {
            mainHandler.postDelayed(currentFade, stepInterval);
        }
    }

    private void sync(boolean fade) {
        boolean wantsToPlay = audible() && musicScene;

        if (wantsToPlay) {
            if (mediaPlayer == null) {
                initMediaPlayer();
                return;
            }
            if (!mediaPlayerPrepared) {
                return;
            }

            if (!focusHeld) {
                boolean granted = requestAudioFocus();
                if (!granted) {
                    return;
                }
            }

            cancelFade();
            try {
                if (!mediaPlayer.isPlaying()) {
                    mediaPlayer.setVolume(currentVolume, currentVolume);
                    mediaPlayer.start();
                }
            } catch (Exception e) {
                Log.w(TAG, "mediaPlayer start failed: " + e.getMessage());
                releaseMediaPlayer();
                return;
            }

            float target = ducked ? (TARGET_GAIN * 0.30f) : TARGET_GAIN;
            if (fade) {
                fadeVolumeTo(target, null);
            } else {
                currentVolume = target;
                try {
                    mediaPlayer.setVolume(currentVolume, currentVolume);
                } catch (Exception ignored) {}
            }
        } else {
            if (mediaPlayer == null || !mediaPlayerPrepared) {
                if (!focusPaused) {
                    abandonAudioFocus();
                }
                return;
            }

            if (fade) {
                fadeVolumeTo(0.0f, () -> {
                    try {
                        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                            mediaPlayer.pause();
                        }
                    } catch (Exception ignored) {}
                    if (!focusPaused) {
                        abandonAudioFocus();
                    }
                });
            } else {
                cancelFade();
                try {
                    if (mediaPlayer.isPlaying()) {
                        mediaPlayer.pause();
                    }
                    currentVolume = 0.0f;
                    mediaPlayer.setVolume(0.0f, 0.0f);
                } catch (Exception ignored) {}
                if (!focusPaused) {
                    abandonAudioFocus();
                }
            }
        }
    }

    private boolean isMusicPlaying() {
        if (mediaPlayer != null && mediaPlayerPrepared) {
            try {
                return mediaPlayer.isPlaying();
            } catch (Exception ignored) {}
        }
        return false;
    }

    private void initSoundPool() {
        if (soundPool != null) return;
        try {
            AudioAttributes cueAttrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            soundPool = new SoundPool.Builder()
                    .setMaxStreams(4)
                    .setAudioAttributes(cueAttrs)
                    .build();
            soundPool.setOnLoadCompleteListener((sp, sampleId, status) ->
                    runOnMain(() -> handleSoundPoolLoaded(sampleId, status)));
        } catch (Exception e) {
            Log.w(TAG, "initSoundPool failed: " + e.getMessage());
            soundPool = null;
        }
    }

    private void releaseSoundPool() {
        stopAllCues();
        if (soundPool != null) {
            try {
                soundPool.release();
            } catch (Exception e) {
                Log.w(TAG, "releaseSoundPool failed: " + e.getMessage());
            }
            soundPool = null;
        }
        cueToSoundId.clear();
        soundIdToCue.clear();
        loadedSoundIds.clear();
        pendingPlays.clear();
    }

    private void stopAllCues() {
        if (soundPool != null) {
            for (int streamId : activeStreams) {
                try {
                    soundPool.stop(streamId);
                } catch (Exception ignored) {}
            }
            activeStreams.clear();
            lastVoiceStream = 0;
        }
        for (PendingCuePlay p : pendingPlays.values()) {
            try {
                p.call.resolve(new JSObject().put("played", false));
            } catch (Exception ignored) {}
        }
        pendingPlays.clear();
    }

    private int playSoundPoolSample(int soundId, String channel) {
        if (soundPool == null) return 0;
        try {
            if ("voice".equals(channel) && lastVoiceStream != 0) {
                soundPool.stop(lastVoiceStream);
                activeStreams.remove(lastVoiceStream);
                lastVoiceStream = 0;
            }
            int streamId = soundPool.play(soundId, 1.0f, 1.0f, 1, 0, 1.0f);
            if (streamId != 0) {
                if ("voice".equals(channel)) {
                    lastVoiceStream = streamId;
                }
                activeStreams.add(streamId);
            }
            return streamId;
        } catch (Exception e) {
            Log.w(TAG, "playSoundPoolSample failed: " + e.getMessage());
            return 0;
        }
    }

    private void handleSoundPoolLoaded(int sampleId, int status) {
        if (status == 0) {
            loadedSoundIds.add(sampleId);
            PendingCuePlay pending = pendingPlays.remove(sampleId);
            if (pending != null) {
                long age = SystemClock.uptimeMillis() - pending.timestamp;
                if (age < 400 && audible()) {
                    int streamId = playSoundPoolSample(sampleId, pending.channel);
                    pending.call.resolve(new JSObject().put("played", streamId != 0));
                } else {
                    pending.call.resolve(new JSObject().put("played", false));
                }
            }
        } else {
            PendingCuePlay pending = pendingPlays.remove(sampleId);
            if (pending != null) {
                pending.call.resolve(new JSObject().put("played", false));
            }
        }
    }

    // --- Plugin Methods (arrive on background threads, all resolve, never reject) ---

    @PluginMethod
    public void unlock(PluginCall call) {
        runOnMain(() -> {
            try {
                unlocked = true;
                sync(true);
            } catch (Exception e) {
                Log.w(TAG, "unlock failed: " + e.getMessage());
            } finally {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        runOnMain(() -> {
            try {
                Boolean req = call.getBoolean("enabled");
                enabled = req != null ? req : true;
                getContext().getSharedPreferences("poker_audio", Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean("sound_on", enabled)
                        .apply();
                if (!enabled) {
                    stopAllCues();
                    sync(false);
                } else {
                    hold = false;
                    unlocked = true;
                    sync(true);
                }
            } catch (Exception e) {
                Log.w(TAG, "setEnabled failed: " + e.getMessage());
            } finally {
                call.resolve(new JSObject().put("enabled", enabled));
            }
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        runOnMain(() -> {
            JSObject res = new JSObject();
            try {
                res.put("enabled", enabled);
                res.put("unlocked", unlocked);
                res.put("musicPlaying", isMusicPlaying());
            } catch (Exception e) {
                Log.w(TAG, "getState failed: " + e.getMessage());
                res.put("enabled", enabled);
                res.put("unlocked", unlocked);
                res.put("musicPlaying", false);
            } finally {
                call.resolve(res);
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        runOnMain(() -> {
            try {
                String cue = call.getString("cue");
                if (cue == null || !CUE_PATTERN.matcher(cue).matches() || "lobby".equals(cue)) {
                    call.resolve(new JSObject().put("played", false));
                    return;
                }
                String fileName = assetFiles.get(cue);
                if (fileName == null || !audible()) {
                    call.resolve(new JSObject().put("played", false));
                    return;
                }

                String channel = "voice".equals(call.getString("channel")) ? "voice" : "sfx";
                initSoundPool();
                if (soundPool == null) {
                    call.resolve(new JSObject().put("played", false));
                    return;
                }

                Integer soundId = cueToSoundId.get(cue);
                if (soundId == null) {
                    AssetFileDescriptor afd = getContext().getAssets().openFd("public/mobile/audio/" + fileName);
                    soundId = soundPool.load(afd, 1);
                    afd.close();
                    cueToSoundId.put(cue, soundId);
                    soundIdToCue.put(soundId, cue);
                }

                if (loadedSoundIds.contains(soundId)) {
                    int streamId = playSoundPoolSample(soundId, channel);
                    call.resolve(new JSObject().put("played", streamId != 0));
                } else {
                    final int sId = soundId;
                    pendingPlays.put(soundId, new PendingCuePlay(cue, channel, SystemClock.uptimeMillis(), call));
                    if (mainHandler != null) {
                        mainHandler.postDelayed(() -> {
                            PendingCuePlay p = pendingPlays.remove(sId);
                            if (p != null) {
                                p.call.resolve(new JSObject().put("played", false));
                            }
                        }, 400);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "play failed: " + e.getMessage());
                call.resolve(new JSObject().put("played", false));
            }
        });
    }

    @PluginMethod
    public void preload(PluginCall call) {
        runOnMain(() -> {
            try {
                JSArray cues = call.getArray("cues");
                if (cues != null) {
                    initSoundPool();
                    if (soundPool != null) {
                        for (int i = 0; i < cues.length(); i++) {
                            String cue = cues.optString(i);
                            if (cue != null && CUE_PATTERN.matcher(cue).matches() && !"lobby".equals(cue)) {
                                String fileName = assetFiles.get(cue);
                                if (fileName != null && !cueToSoundId.containsKey(cue)) {
                                    try {
                                        AssetFileDescriptor afd = getContext().getAssets().openFd("public/mobile/audio/" + fileName);
                                        int soundId = soundPool.load(afd, 1);
                                        afd.close();
                                        cueToSoundId.put(cue, soundId);
                                        soundIdToCue.put(soundId, cue);
                                    } catch (Exception ignored) {}
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "preload failed: " + e.getMessage());
            } finally {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runOnMain(() -> {
            try {
                stopAllCues();
            } catch (Exception e) {
                Log.w(TAG, "stop failed: " + e.getMessage());
            } finally {
                call.resolve();
            }
        });
    }
}
