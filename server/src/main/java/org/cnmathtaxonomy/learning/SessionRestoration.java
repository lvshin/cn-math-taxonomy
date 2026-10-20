package org.cnmathtaxonomy.learning;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.authentication.SimpleUrlAuthenticationFailureHandler;
import org.springframework.security.web.authentication.logout.LogoutHandler;

/** A hint to try real OIDC again, never a credential or a source of identity. */
final class SessionRestoration implements AuthenticationSuccessHandler, AuthenticationFailureHandler, LogoutHandler {
    static final String COOKIE = "LEARNING_RETURNING";
    private static final String RESTORE_STATE = SessionRestoration.class.getName() + ".STATE";
    private static final Duration MARKER_LIFETIME = Duration.ofDays(30);
    private final AuthenticationFailureHandler ordinaryFailure = new SimpleUrlAuthenticationFailureHandler("/login?error");

    static boolean hasMarker(HttpServletRequest request) {
        if (request.getCookies() != null) {
            for (var cookie : request.getCookies()) {
                if (COOKIE.equals(cookie.getName()) && "1".equals(cookie.getValue())) {
                    return true;
                }
            }
        }
        return false;
    }

    static void rememberAttempt(HttpServletRequest request, String state) {
        request.getSession().setAttribute(RESTORE_STATE, state);
    }

    static void forgetAttempt(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) {
            session.removeAttribute(RESTORE_STATE);
        }
    }

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response, Authentication authentication)
            throws IOException {
        forgetAttempt(request);
        marker(response, request, MARKER_LIFETIME);
        response.sendRedirect(request.getContextPath() + "/");
    }

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response, AuthenticationException exception)
            throws IOException, ServletException {
        var session = request.getSession(false);
        var state = session == null ? null : session.getAttribute(RESTORE_STATE);
        boolean restoring = state instanceof String && state.equals(request.getParameter("state"));
        forgetAttempt(request);
        // Clear on ordinary errors as well: an interrupted/expired attempt cannot start a retry loop.
        marker(response, request, Duration.ZERO);
        if (restoring) {
            response.sendRedirect(request.getContextPath() + "/#family");
        } else {
            ordinaryFailure.onAuthenticationFailure(request, response, exception);
        }
    }

    @Override
    public void logout(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        forgetAttempt(request);
        marker(response, request, Duration.ZERO);
    }

    private static void marker(HttpServletResponse response, HttpServletRequest request, Duration age) {
        String path = request.getContextPath().isEmpty() ? "/" : request.getContextPath();
        var cookie = ResponseCookie.from(COOKIE, age.isZero() ? "" : "1").path(path)
                .httpOnly(true).secure(true).sameSite("Lax").maxAge(age).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }
}
