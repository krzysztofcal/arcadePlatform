package pl.kcswh.arcadepoker.stage;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.util.regex.Pattern;

// #1300: explicit "Sign in with Google" through Android Credential Manager. Returns only the Google ID token for
// Supabase signInWithIdToken; the token, nonce and account data are never logged or stored here.
@CapacitorPlugin(name = "PokerGoogleSignIn")
public class PokerGoogleSignInPlugin extends Plugin {
    private static final Pattern NONCE = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern WEB_CLIENT_ID = Pattern.compile("^[0-9]{6,32}-[0-9a-z]{16,64}\\.apps\\.googleusercontent\\.com$");
    private boolean inFlight;

    // Public Web OAuth client ID (server audience), written at build time by configure-android.mjs; absent on Stage.
    private String webClientId() {
        int id = getContext().getResources().getIdentifier("poker_google_web_client_id", "string", getContext().getPackageName());
        if (id == 0) return null;
        String value = getContext().getString(id);
        return WEB_CLIENT_ID.matcher(value).matches() ? value : null;
    }

    private synchronized boolean begin() {
        if (inFlight) return false;
        inFlight = true;
        return true;
    }

    private synchronized void end() {
        inFlight = false;
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = webClientId();
        String nonce = call.getString("nonce");
        if (clientId == null) {
            call.reject("Google sign-in unavailable", "unavailable");
            return;
        }
        if (nonce == null || !NONCE.matcher(nonce).matches()) {
            call.reject("Invalid Google sign-in request", "invalid_request");
            return;
        }
        if (getActivity() == null) {
            call.reject("Google sign-in unavailable", "unavailable");
            return;
        }
        if (!begin()) {
            call.reject("Google sign-in busy", "busy");
            return;
        }
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(getContext()).getCredentialAsync(getActivity(), request, new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()), new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    end();
                    Credential credential = response.getCredential();
                    if (credential instanceof CustomCredential
                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        try {
                            String idToken = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                            if (idToken != null && !idToken.isEmpty()) {
                                JSObject result = new JSObject();
                                result.put("idToken", idToken);
                                call.resolve(result);
                                return;
                            }
                        } catch (Exception ignored) {
                            // Fall through to a generic failure without exposing provider details.
                        }
                    }
                    call.reject("Google sign-in failed", "failed");
                }

                @Override
                public void onError(GetCredentialException error) {
                    end();
                    if (error instanceof GetCredentialCancellationException) call.reject("Google sign-in canceled", "canceled");
                    else if (error instanceof NoCredentialException) call.reject("No Google account available", "no_credential");
                    else call.reject("Google sign-in failed", "failed");
                }
            });
    }

    // Explicit sign-out: forget the selected account so the next sign-in can choose another one.
    @PluginMethod
    public void clearCredential(PluginCall call) {
        CredentialManager.create(getContext()).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()), new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    call.resolve();
                }

                @Override
                public void onError(ClearCredentialException error) {
                    call.reject("Google credential state not cleared", "failed");
                }
            });
    }
}
