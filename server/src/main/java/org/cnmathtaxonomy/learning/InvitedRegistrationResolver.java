package org.cnmathtaxonomy.learning;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.web.util.UriComponentsBuilder;

/** Uses the normal OAuth2 state/nonce/session flow while selecting the controlled registration page. */
final class InvitedRegistrationResolver implements OAuth2AuthorizationRequestResolver {
    private final DefaultOAuth2AuthorizationRequestResolver delegate;

    InvitedRegistrationResolver(ClientRegistrationRepository clients) {
        this.delegate = new DefaultOAuth2AuthorizationRequestResolver(clients, "/oauth2/authorization");
        this.delegate.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
        return customize(request, delegate.resolve(request));
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String clientRegistrationId) {
        return customize(request, delegate.resolve(request, clientRegistrationId));
    }

    private OAuth2AuthorizationRequest customize(HttpServletRequest request, OAuth2AuthorizationRequest resolved) {
        String grant = request.getParameter("invite_grant");
        if (resolved == null || grant == null) {
            return resolved;
        }
        if (!grant.matches("[A-Za-z0-9_-]{32,512}")) {
            throw ApiException.invalid("注册授权格式不正确");
        }
        String path = java.net.URI.create(resolved.getAuthorizationUri()).getPath();
        if (!path.endsWith("/protocol/openid-connect/auth")) {
            throw new IllegalStateException("Controlled registration requires a Keycloak OIDC authorization endpoint");
        }
        String registrationPath = path.substring(0, path.length() - "/auth".length()) + "/registrations";
        String uri = UriComponentsBuilder.fromUriString(resolved.getAuthorizationRequestUri()).replacePath(registrationPath)
                .queryParam("invite_grant", grant).build(true).toUriString();
        return OAuth2AuthorizationRequest.from(resolved).authorizationRequestUri(uri).build();
    }
}
