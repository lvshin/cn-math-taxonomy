package org.cnmathtaxonomy.identity;

import java.io.IOException;
import java.util.List;
import org.keycloak.Config;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.AuthenticationFlowException;
import org.keycloak.authentication.FormAction;
import org.keycloak.authentication.FormActionFactory;
import org.keycloak.authentication.FormContext;
import org.keycloak.authentication.ValidationContext;
import org.keycloak.events.Errors;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.AbstractKeycloakTransaction;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.services.Urls;

/** REQUIRED action, ordered after user creation; all validation runs before creation. */
public final class InvitationFormAction implements FormAction, FormActionFactory {
    public static final String ID = "learning-invitation-registration";
    private static final String GRANT = "learning.invitation.grant";
    private static final String RESERVATION = "learning.invitation.reservation";
    private static final String INVALID = "Invitation is missing, expired, revoked or unavailable. Return to the invitation to try again.";

    private String allowedClient;
    private RegistrationGateway gateway;

    @Override public void init(Config.Scope config) {
        allowedClient = System.getenv("LEARNING_REGISTRATION_CLIENT_ID");
        try { gateway = new RegistrationGateway(System.getenv("LEARNING_REGISTRATION_BACKEND_URL"),
                System.getenv("LEARNING_REGISTRATION_KEY")); }
        catch (IllegalArgumentException ignored) { gateway = null; }
    }

    @Override public void buildPage(FormContext context, LoginFormsProvider form) {
        var auth = context.getAuthenticationSession();
        String incoming = context.getHttpRequest().getUri().getQueryParameters().getFirst("invite_grant");
        // The initial query disappears on form POST; retain it only in the server authentication session.
        // Replacing a grant on an existing tab is forbidden, including after validation errors.
        if (auth.getAuthNote(GRANT) == null && validGrant(incoming)) auth.setAuthNote(GRANT, incoming);
        if (!configuredClient(context) || !validGrant(auth.getAuthNote(GRANT))) form.setError(INVALID);
    }

    @Override public void validate(ValidationContext context) {
        var auth = context.getAuthenticationSession();
        var data = context.getHttpRequest().getDecodedFormParameters();
        String grant = auth.getAuthNote(GRANT);
        String username = data.getFirst(context.getRealm().isRegistrationEmailAsUsername() ? "email" : "username");
        if (!configuredClient(context) || !validGrant(grant) || username == null || username.isBlank()) {
            reject(context); return;
        }
        try {
            String reservation = gateway.reserve(grant, auth.getClient().getClientId(), authSessionId(context), username);
            auth.setAuthNote(RESERVATION, reservation);
            context.success();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); reject(context);
        } catch (IOException | RuntimeException rejected) { reject(context); }
    }

    @Override public void success(FormContext context) {
        var auth = context.getAuthenticationSession();
        String reservation = auth.getAuthNote(RESERVATION);
        if (!configuredClient(context) || reservation == null || context.getUser() == null)
            failClosed(context);
        String issuer = Urls.realmIssuer(context.getUriInfo().getBaseUri(), context.getRealm().getName());
        // Persist proof in the SAME Keycloak transaction as the new identity, before an external bind.
        // A signed receipt lets the authenticated backend finish an uncertain external commit.
        try {
            String receipt = gateway.receipt(reservation, auth.getClient().getClientId(), authSessionId(context), issuer, context.getUser().getId());
            context.getUser().setSingleAttribute("learning_registration_receipt", receipt);
        } catch (IOException | RuntimeException failed) { failClosed(context); }
        String clientId = auth.getClient().getClientId();
        String sessionId = authSessionId(context);
        String subject = context.getUser().getId();
        // Never bind a subject before its Keycloak transaction commits: a local rollback would
        // otherwise leave an irrevocable business reservation pointing to a nonexistent identity.
        context.getSession().getTransactionManager().enlistAfterCompletion(new AbstractKeycloakTransaction() {
            @Override protected void commitImpl() {
                try { gateway.bind(reservation, clientId, sessionId, issuer, subject); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                catch (IOException | RuntimeException rejected) {
                    // Identity + HMAC proof are already durable. The authenticated backend resumes.
                }
            }
            @Override protected void rollbackImpl() { /* No external bind for an uncommitted identity. */ }
        });
        auth.removeAuthNote(GRANT);
        auth.removeAuthNote(RESERVATION);
    }

    private static void failClosed(FormContext context) {
        // The flow processor catches AuthenticationFlowException. Explicit rollback is essential:
        // throwing alone can leave the User Creation action committed after a failed bind.
        context.getSession().getTransactionManager().setRollbackOnly();
        throw new AuthenticationFlowException(AuthenticationFlowError.INTERNAL_ERROR);
    }

    private boolean configuredClient(FormContext context) {
        return gateway != null && allowedClient != null && !allowedClient.isBlank()
                && allowedClient.equals(context.getAuthenticationSession().getClient().getClientId());
    }
    private static boolean validGrant(String value) { return value != null && value.matches("[A-Za-z0-9_-]{32,512}"); }
    private static String authSessionId(FormContext context) {
        var auth = context.getAuthenticationSession();
        return auth.getParentSession().getId() + ":" + auth.getTabId();
    }
    private static void reject(ValidationContext context) {
        context.error(Errors.INVALID_REGISTRATION);
        context.validationError(context.getHttpRequest().getDecodedFormParameters(), List.of(new FormMessage(null, INVALID)));
    }

    @Override public String getId() { return ID; }
    @Override public String getDisplayType() { return "Learning invitation (required)"; }
    @Override public String getReferenceCategory() { return "learning-invitation"; }
    @Override public String getHelpText() { return "Requires an unexpired invitation and the configured education client; fails closed."; }
    @Override public boolean isConfigurable() { return false; }
    @Override public boolean isUserSetupAllowed() { return false; }
    @Override public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return new AuthenticationExecutionModel.Requirement[]{AuthenticationExecutionModel.Requirement.REQUIRED};
    }
    @Override public List<ProviderConfigProperty> getConfigProperties() { return List.of(); }
    @Override public FormAction create(KeycloakSession session) { return this; }
    @Override public void postInit(KeycloakSessionFactory factory) { }
    @Override public boolean requiresUser() { return false; }
    @Override public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) { return true; }
    @Override public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) { }
    @Override public void close() { }
}
