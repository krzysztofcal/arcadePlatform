package pl.kcswh.arcadepoker.stage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.SoundPool;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.regex.Pattern;

// The single audio owner. It lives with the Activity/Bridge, not with an HTML document, so the
// music player and its playhead survive every WebView page navigation. All state is main-thread only.
@CapacitorPlugin(name = "PokerAudio")
public class PokerAudioPlugin extends Plugin {
    private static final String TAG = "PokerAudio";
    private static final String DIR = "public/mobile/audio";
    private static final String MUSIC = "lobby";
    private static final float GAIN = 0.35f;
    private static final float DUCK = 0.3f;
    private static final long FADE_MS = 600;
    private static final long STEP_MS = 50;
    private static final long STALE_MS = 400;
    private static final int MAX_STREAMS = 4;
    private static final Pattern CUE = Pattern.compile("[a-z0-9_]{1,40}");

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, String> files = new HashMap<>(); // cue -> bundled file name
    private final Map<String, Integer> sounds = new HashMap<>(); // cue -> SoundPool id
    private final Set<Integer> loaded = new HashSet<>();
    private final Map<Integer, long[]> pending = new HashMap<>(); // id -> {requested at, voice}
    private final ArrayDeque<Integer> streams = new ArrayDeque<>();
    private AudioManager audioManager;
    private MediaPlayer player;
    private SoundPool pool;
    private boolean enabled = true; // persisted; every other flag is per process
    private boolean unlocked; // a user gesture happened
    private boolean resumed; // Activity is in the foreground
    private boolean musicScene; // current document is a lobby/profile page
    private boolean hold; // route or focus was lost; wait for the next foreground or Sound ON
    private boolean focusPaused; // transient focus loss, e.g. a phone call
    private boolean focusHeld;
    private boolean ducked;
    private boolean prepared;
    private boolean listening;
    private float volume;
    private float fadeTarget;
    private int voiceStream;

    private final AudioManager.OnAudioFocusChangeListener focus = change -> main.post(() -> {
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            focusPaused = false;
            ducked = false;
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            ducked = true;
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            focusPaused = true;
        } else if (change == AudioManager.AUDIOFOCUS_LOSS) {
            focusHeld = false;
            hold = true;
        } else return;
        if (!canPlay()) stopCues();
        sync(canPlay());
    });

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Headphones/Bluetooth went away: never continue on the phone speaker.
            hold = true;
            stopCues();
            sync(false);
        }
    };

    private final Runnable fadeStep = new Runnable() {
        @Override
        public void run() {
            try {
                if (player == null || !prepared) return;
                float step = GAIN * STEP_MS / FADE_MS;
                volume = Math.abs(fadeTarget - volume) <= step ? fadeTarget : volume + Math.signum(fadeTarget - volume) * step;
                player.setVolume(volume, volume);
                if (volume != fadeTarget) main.postDelayed(this, STEP_MS);
                else if (fadeTarget == 0f) pauseMusic();
            } catch (RuntimeException error) {
                fail(error);
            }
        }
    };

    @Override
    public void load() {
        try {
            audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            enabled = getContext().getSharedPreferences("poker_audio", Context.MODE_PRIVATE).getBoolean("sound_on", true);
            String[] names = getContext().getAssets().list(DIR);
            if (names != null) for (String name : names) {
                int dot = name.lastIndexOf('.');
                if (dot > 0) files.put(name.substring(0, dot), name);
            }
        } catch (IOException | RuntimeException error) {
            fail(error);
        }
    }

    @Override
    protected void handleOnStart() {
        if (listening) return;
        listening = true;
        try {
            // Not in load(): Capacitor replaces the listener list right after it constructs the bridge.
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    Uri page = Uri.parse(url == null ? "" : url);
                    String path = page.getPath();
                    // Positive list: table, Offline, legal and unknown documents never carry music.
                    musicScene = "https".equals(page.getScheme()) && "localhost".equals(page.getHost())
                        && ("/poker/index.html".equals(path) || "/poker/".equals(path) || "/account.html".equals(path));
                    sync(true);
                }
            });
            ContextCompat.registerReceiver(getContext(), noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (RuntimeException error) {
            fail(error);
        }
    }

    @Override
    protected void handleOnResume() {
        resumed = true;
        hold = false;
        sync(true);
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
        focusPaused = false; // focus is given up below and requested again on return
        stopCues();
        sync(false);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (listening) getContext().unregisterReceiver(noisy);
        } catch (RuntimeException error) {
            fail(error);
        }
        releaseMusic();
        stopCues();
        dropFocus();
        if (pool != null) pool.release();
        pool = null;
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        run(call, () -> {
            unlocked = true;
            sync(true);
            return null;
        });
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        run(call, () -> {
            enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
            getContext().getSharedPreferences("poker_audio", Context.MODE_PRIVATE).edit().putBoolean("sound_on", enabled).apply();
            if (enabled) {
                hold = false;
                unlocked = true; // the toggle is itself a user gesture
            } else {
                focusPaused = false; // a deliberate OFF also gives up a call-interrupted focus request
                stopCues();
            }
            sync(enabled);
            return state();
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        run(call, this::state);
    }

    @PluginMethod
    public void play(PluginCall call) {
        run(call, () -> {
            boolean voice = "voice".equals(call.getString("channel"));
            Integer id = canPlay() ? loadCue(call.getString("cue")) : null;
            boolean played = id != null && loaded.contains(id) && startCue(id, voice);
            // A cue that is still decoding may start late, but only while it is still relevant.
            if (id != null && !loaded.contains(id)) pending.put(id, new long[] { SystemClock.uptimeMillis(), voice ? 1 : 0 });
            return new JSObject().put("played", played);
        });
    }

    @PluginMethod
    public void preload(PluginCall call) {
        run(call, () -> {
            JSArray cues = call.getArray("cues");
            for (int i = 0; cues != null && i < cues.length(); i++) loadCue(cues.optString(i));
            return null;
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        run(call, () -> {
            stopCues();
            return null;
        });
    }

    // Plugin calls arrive on Capacitor's worker thread. They always resolve: audio must never break a page.
    private void run(PluginCall call, Callable<JSObject> body) {
        main.post(() -> {
            JSObject result = null;
            try {
                result = body.call();
            } catch (Exception error) {
                fail(error);
            }
            if (result == null) call.resolve();
            else call.resolve(result);
        });
    }

    private JSObject state() {
        boolean playing = false;
        try {
            playing = player != null && prepared && player.isPlaying();
        } catch (RuntimeException error) {
            fail(error);
        }
        return new JSObject().put("enabled", enabled).put("unlocked", unlocked).put("musicPlaying", playing);
    }

    private boolean audible() {
        return enabled && unlocked && resumed && !hold && !focusPaused;
    }

    // Music and cues both need the focus that sync() holds for as long as the app may be heard.
    private boolean canPlay() {
        return audible() && focusHeld;
    }

    private void fail(Exception error) {
        Log.w(TAG, error.getClass().getSimpleName());
    }

    // The one place that decides focus and whether music plays. fade=false silences immediately.
    @SuppressWarnings("deprecation") // one focus API for every supported level (minSdk 24)
    private void sync(boolean fade) {
        try {
            if (audible() && !focusHeld) focusHeld = audioManager.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            boolean want = canPlay() && musicScene;
            if (want && player == null) openMusic(); // continues from onPrepared
            else if (player != null && prepared) {
                if (want) {
                    if (!player.isPlaying()) player.start(); // resumes at the kept position
                    fadeTo(GAIN * (ducked ? DUCK : 1f));
                } else if (fade && player.isPlaying()) fadeTo(0f);
                else pauseMusic();
            }
            // Keep the request only during a transient loss, to hear GAIN after e.g. a call.
            if (!audible() && !focusPaused) dropFocus();
        } catch (RuntimeException error) {
            fail(error);
            releaseMusic();
        }
    }

    private void fadeTo(float target) {
        fadeTarget = target;
        main.removeCallbacks(fadeStep);
        main.post(fadeStep);
    }

    // Pause keeps the playhead; the track is never rewound.
    private void pauseMusic() {
        main.removeCallbacks(fadeStep);
        volume = 0f;
        if (player != null && prepared) {
            if (player.isPlaying()) player.pause();
            player.setVolume(0f, 0f);
        }
    }

    @SuppressWarnings("deprecation")
    private void dropFocus() {
        if (!focusHeld) return;
        focusHeld = false;
        ducked = false;
        audioManager.abandonAudioFocus(focus);
    }

    private AudioAttributes attributes(int contentType) {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(contentType).build();
    }

    private void openMusic() {
        String file = files.get(MUSIC);
        if (file == null) return;
        MediaPlayer next = new MediaPlayer();
        player = next;
        prepared = false;
        volume = 0f;
        try (AssetFileDescriptor fd = getContext().getAssets().openFd(DIR + "/" + file)) {
            next.setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_MUSIC));
            next.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            next.setLooping(true);
            next.setVolume(0f, 0f);
            next.setOnPreparedListener(ready -> {
                if (ready != player) return;
                prepared = true;
                sync(true);
            });
            next.setOnErrorListener((broken, what, extra) -> {
                Log.w(TAG, "music error " + what);
                if (broken == player) releaseMusic(); // a later navigation or resume may try again
                return true;
            });
            next.prepareAsync();
        } catch (IOException | RuntimeException error) {
            fail(error);
            releaseMusic();
        }
    }

    private void releaseMusic() {
        main.removeCallbacks(fadeStep);
        try {
            if (player != null) player.release();
        } catch (RuntimeException error) {
            fail(error);
        }
        player = null;
        prepared = false;
    }

    private Integer loadCue(String cue) throws IOException {
        String file = cue == null || !CUE.matcher(cue).matches() || MUSIC.equals(cue) ? null : files.get(cue);
        if (file == null) return null;
        Integer id = sounds.get(cue);
        if (id != null) return id;
        if (pool == null) {
            pool = new SoundPool.Builder().setMaxStreams(MAX_STREAMS).setAudioAttributes(attributes(AudioAttributes.CONTENT_TYPE_SONIFICATION)).build();
            pool.setOnLoadCompleteListener((source, sampleId, status) -> main.post(() -> cueLoaded(sampleId, status)));
        }
        try (AssetFileDescriptor fd = getContext().getAssets().openFd(DIR + "/" + file)) {
            id = pool.load(fd, 1);
        }
        sounds.put(cue, id);
        return id;
    }

    private void cueLoaded(int id, int status) {
        long[] request = pending.remove(id);
        if (status != 0 || pool == null) return;
        loaded.add(id);
        try {
            // Stale cues are dropped rather than played late.
            if (request != null && canPlay() && SystemClock.uptimeMillis() - request[0] <= STALE_MS) startCue(id, request[1] == 1);
        } catch (RuntimeException error) {
            fail(error);
        }
    }

    private boolean startCue(int id, boolean voice) {
        if (voice && voiceStream != 0) pool.stop(voiceStream); // one dealer line at a time
        int stream = pool.play(id, 1f, 1f, voice ? 2 : 1, 0, 1f);
        if (stream == 0) return false;
        if (voice) voiceStream = stream;
        else {
            streams.add(stream);
            if (streams.size() > MAX_STREAMS) pool.stop(streams.remove());
        }
        return true;
    }

    private void stopCues() {
        pending.clear();
        try {
            if (pool != null) {
                if (voiceStream != 0) pool.stop(voiceStream);
                for (int stream : streams) pool.stop(stream);
            }
        } catch (RuntimeException error) {
            fail(error);
        }
        voiceStream = 0;
        streams.clear();
    }
}
