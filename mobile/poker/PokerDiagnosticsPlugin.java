package pl.kcswh.arcadepoker.stage;

import android.content.pm.PackageManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.crashlytics.CustomKeysAndValues;
import com.google.firebase.crashlytics.FirebaseCrashlytics;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "PokerDiagnostics")
public class PokerDiagnosticsPlugin extends Plugin {
    private static final Map<String, List<String>> ALLOWED = new HashMap<>();
    static {
        ALLOWED.put("google_credential", Arrays.asList("credential_manager", "unexpected_credential", "config_missing"));
        ALLOWED.put("google_failed", Arrays.asList("bridge", "credential_manager", "id_token_exchange", "unexpected"));
        ALLOWED.put("auth_callback_failed", Arrays.asList("callback_exchange"));
        ALLOWED.put("google_clear_failed", Arrays.asList("sign_out"));
        ALLOWED.put("js_uncaught", Arrays.asList("window", "offline"));
        ALLOWED.put("js_unhandled_rejection", Arrays.asList("window", "offline"));
        ALLOWED.put("selftest", Arrays.asList("handled"));
    }
    private static final Pattern JS_FILE = Pattern.compile("[a-z0-9_.-]{1,40}\\.js");
    private static final Pattern CLASSIFIER = Pattern.compile("[A-Za-z0-9_.]{1,128}");
    private static final Set<String> RECORDED = new HashSet<>();
    private static FirebaseCrashlytics reporter;
    private static String channel;

    @Override
    public void load() {
        // FirebaseInitProvider runs earlier. This controls only the app's explicit non-fatal reports.
        synchronized (PokerDiagnosticsPlugin.class) {
            try {
                var context = getContext();
                var metadata = context.getPackageManager()
                    .getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA).metaData;
                if (metadata == null || !metadata.getBoolean("poker_diagnostics_enabled", false)) return;
                channel = context.getString(R.string.poker_build_channel);
                FirebaseCrashlytics sdk = FirebaseCrashlytics.getInstance();
                sdk.setCustomKey("build_channel", channel);
                sdk.setCustomKey("source_sha", context.getString(R.string.poker_source_sha));
                reporter = sdk;
            } catch (Exception | LinkageError ignored) {
                reporter = null;
            }
        }
    }

    @PluginMethod
    public void report(PluginCall call) {
        try {
            synchronized (PokerDiagnosticsPlugin.class) {
                if (reporter == null) return;
            }
            String code = call.getString("code");
            if ("google_credential".equals(code)) return;
            var keys = new CustomKeysAndValues.Builder();
            if ("js_uncaught".equals(code)) {
                String file = call.getString("js_file");
                Integer line = call.getInt("js_line");
                if (file != null && JS_FILE.matcher(file).matches()) keys.putString("js_file", file);
                if (line != null && line >= 1 && line <= 999999) keys.putInt("js_line", line);
            }
            record(code, call.getString("stage"), keys);
        } finally {
            call.resolve();
        }
    }

    static synchronized void recordCredential(String stage, String exception, String type) {
        if (reporter == null) return;
        var keys = new CustomKeysAndValues.Builder();
        if ("credential_manager".equals(stage)) {
            keys.putString("exception", classifier(exception));
            keys.putString("type", classifier(type));
        }
        record("google_credential", stage, keys);
    }

    private static String classifier(String value) {
        return value != null && CLASSIFIER.matcher(value).matches() ? value : "other";
    }

    private static synchronized void record(String code, String stage, CustomKeysAndValues.Builder keys) {
        if (reporter == null || code == null || stage == null || RECORDED.size() >= 7) return;
        List<String> stages = ALLOWED.get(code);
        if (stages == null || !stages.contains(stage)) return;
        if ("selftest".equals(code) && !"stage".equals(channel)) return;
        if ("config_missing".equals(stage) && !"production".equals(channel)) return;
        String grouping = code + ":" + stage;
        if (!RECORDED.add(grouping)) return;
        try {
            Exception diagnostic = new PokerDiagnostic(grouping);
            diagnostic.setStackTrace(new StackTraceElement[]{ new StackTraceElement("PokerDiagnostic", code, stage, 1) });
            reporter.recordException(diagnostic, keys.build());
        } catch (Throwable ignored) {
            // Diagnostics must not affect app behavior.
        }
    }

    private static final class PokerDiagnostic extends Exception {
        PokerDiagnostic(String grouping) {
            super(grouping);
        }
    }
}
