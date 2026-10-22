package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.oauth2.client.OidcBackChannelLogoutHandler;
import org.springframework.security.oauth2.client.oidc.session.InMemoryOidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionRegistry;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
class SecurityConfiguration {
    @Bean
    OidcSessionRegistry oidcSessionRegistry() {
        return new InMemoryOidcSessionRegistry();
    }

    @Bean
    OidcBackChannelLogoutHandler backChannelLogoutHandler(OidcSessionRegistry sessions, @Value("${server.port:8080}") int port) {
        var handler = new OidcBackChannelLogoutHandler(sessions);
        handler.setSessionCookieName("LEARNING_SESSION");
        handler.setLogoutUri("http://127.0.0.1:" + port + "/edu/math/logout");
        return handler;
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ClientRegistrationRepository clients,
            LearningProperties properties, ObjectMapper mapper, OidcBackChannelLogoutHandler backChannelLogoutHandler) throws Exception {
        var logoutHandler = new OidcClientInitiatedLogoutSuccessHandler(clients);
        logoutHandler.setPostLogoutRedirectUri("{baseUrl}/");
        var sessionRestoration = new SessionRestoration();
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers("/healthz", "/readyz", "/api/v1/capabilities", "/api/v1/csrf",
                        "/api/v1/invitations/preview", "/api/v1/invitations/registration-grant", "/internal/registration/**").permitAll()
                .requestMatchers("/api/**").authenticated()
                .requestMatchers("/", "/index.html", "/kindergarten/", "/kindergarten/index.html", "/kindergarten/assets/**", "/assets/**", "/data/**", "/diagnose/engine.js", "/oauth2/**", "/login/**", "/error").permitAll()
                .anyRequest().denyAll())
                .csrf(csrf -> csrf.ignoringRequestMatchers(new AntPathRequestMatcher("/internal/registration/**")))
                .oauth2Login(login -> login.authorizationEndpoint(endpoint -> endpoint.authorizationRequestResolver(new InvitedRegistrationResolver(clients))
                                .authorizationRequestRepository(new ModuleAuthorizationRequestRepository()))
                        .successHandler(sessionRestoration).failureHandler(sessionRestoration))
                .oidcLogout(logout -> logout.backChannel(back -> back.logoutHandler(backChannelLogoutHandler)))
                .logout(logout -> logout.addLogoutHandler(sessionRestoration).logoutSuccessHandler(logoutHandler))
                .exceptionHandling(errors -> errors
                        .defaultAuthenticationEntryPointFor((request, response, exception) -> {
                            response.setStatus(401);
                            response.setContentType("application/problem+json");
                            mapper.writeValue(response.getOutputStream(), Map.of("status", 401, "code", "UNAUTHENTICATED", "detail", "请先登录"));
                        }, new AntPathRequestMatcher("/api/**"))
                        .accessDeniedHandler((request, response, exception) -> {
                            response.setStatus(403);
                            response.setContentType("application/problem+json");
                            mapper.writeValue(response.getOutputStream(), Map.of("status", 403, "code", "FORBIDDEN", "detail", "访问被拒绝，请刷新或重新登录"));
                        }))
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"))
                        .referrerPolicy(referrer -> referrer.policy(org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)));
        http.addFilterBefore(new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                    throws ServletException, IOException {
                String path = request.getRequestURI().substring(request.getContextPath().length());
                if (path.startsWith("/internal/registration/")) {
                    String provided = request.getHeader("X-Registration-Key");
                    String expected = properties.registrationKey();
                    if (expected == null || expected.length() < 32 || provided == null
                            || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), provided.getBytes(StandardCharsets.UTF_8))) {
                        response.sendError(403);
                        return;
                    }
                }
                if (request.getContentLengthLong() > 1_048_576) {
                    response.sendError(413);
                    return;
                }
                if (request.getContentType() != null && request.getContentType().toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) {
                    byte[] body = request.getInputStream().readNBytes(1_048_577);
                    if (body.length > 1_048_576) {
                        response.sendError(413);
                        return;
                    }
                    chain.doFilter(new HttpServletRequestWrapper(request) {
                        @Override
                        public ServletInputStream getInputStream() {
                            var input = new ByteArrayInputStream(body);
                            return new ServletInputStream() {
                                @Override
                                public int read() {
                                    return input.read();
                                }
                                @Override
                                public boolean isFinished() {
                                    return input.available() == 0;
                                }
                                @Override
                                public boolean isReady() {
                                    return true;
                                }
                                @Override
                                public void setReadListener(ReadListener listener) {
                                    throw new IllegalStateException("Asynchronous request bodies are not supported");
                                }
                            };
                        }
                        @Override
                        public BufferedReader getReader() {
                            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
                        }
                    }, response);
                    return;
                }
                chain.doFilter(request, response);
            }
        }, AuthorizationFilter.class);
        return http.build();
    }
}
