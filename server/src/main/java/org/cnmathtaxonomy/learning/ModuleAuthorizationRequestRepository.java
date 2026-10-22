package org.cnmathtaxonomy.learning;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.Serializable;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

/** Session-bound, short-lived OAuth requests keyed by state, so login tabs cannot change one another's destination. */
final class ModuleAuthorizationRequestRepository implements AuthorizationRequestRepository<OAuth2AuthorizationRequest> {
    static final String MODULE = ModuleAuthorizationRequestRepository.class.getName() + ".MODULE";
    static final String RESTORING = ModuleAuthorizationRequestRepository.class.getName() + ".RESTORING";
    private static final String SESSION_KEY = ModuleAuthorizationRequestRepository.class.getName() + ".REQUESTS";
    private static final int MAX_ATTEMPTS = 8;
    private static final long LIFETIME_SECONDS = 600;

    private record Attempt(OAuth2AuthorizationRequest authorization, Instant createdAt) implements Serializable {}

    @Override
    public OAuth2AuthorizationRequest loadAuthorizationRequest(HttpServletRequest request) {
        return find(request, false);
    }

    @Override
    public void saveAuthorizationRequest(OAuth2AuthorizationRequest authorization, HttpServletRequest request, HttpServletResponse response) {
        if (authorization == null) {
            removeAuthorizationRequest(request, response);
            return;
        }
        var session = request.getSession();
        synchronized (session) {
            var attempts = attempts(session.getAttribute(SESSION_KEY));
            prune(attempts);
            while (attempts.size() >= MAX_ATTEMPTS) {
                attempts.remove(attempts.keySet().iterator().next());
            }
            attempts.put(authorization.getState(), new Attempt(authorization, Instant.now()));
            session.setAttribute(SESSION_KEY, attempts);
        }
    }

    @Override
    public OAuth2AuthorizationRequest removeAuthorizationRequest(HttpServletRequest request, HttpServletResponse response) {
        return find(request, true);
    }

    private OAuth2AuthorizationRequest find(HttpServletRequest request, boolean remove) {
        String state = request.getParameter("state");
        var session = request.getSession(false);
        if (state == null || session == null) {
            return null;
        }
        synchronized (session) {
            var attempts = attempts(session.getAttribute(SESSION_KEY));
            prune(attempts);
            Attempt attempt = remove ? attempts.remove(state) : attempts.get(state);
            session.setAttribute(SESSION_KEY, attempts);
            if (attempt == null) {
                return null;
            }
            if (remove) {
                // Only the server-side authorization matched by state supplies these attributes.
                request.setAttribute(MODULE, attempt.authorization().getAttribute(MODULE));
                request.setAttribute(RESTORING, attempt.authorization().getAttribute(RESTORING));
            }
            return attempt.authorization();
        }
    }

    @SuppressWarnings("unchecked")
    private LinkedHashMap<String, Attempt> attempts(Object value) {
        return value instanceof Map<?, ?> ? new LinkedHashMap<>((Map<String, Attempt>) value) : new LinkedHashMap<>();
    }

    private void prune(LinkedHashMap<String, Attempt> attempts) {
        Instant oldest = Instant.now().minusSeconds(LIFETIME_SECONDS);
        attempts.values().removeIf(attempt -> attempt.createdAt().isBefore(oldest));
    }
}
