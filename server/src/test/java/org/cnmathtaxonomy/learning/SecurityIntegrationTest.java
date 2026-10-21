package org.cnmathtaxonomy.learning;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.endpoint.DefaultOAuth2TokenRequestParametersConverter;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.web.HttpSessionOAuth2AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationExchange;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationResponse;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.web.util.UriUtils;

@SpringJUnitWebConfig(classes = {SecurityIntegrationTest.Config.class, SecurityConfiguration.class, LearningController.class, InternalRegistrationController.class, ApiErrors.class})
class SecurityIntegrationTest {
    static final String ISSUER = "https://identity.example.invalid/realms/test";
    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    static class Config {
        @Bean
        LearningService learning() {
            return mock(LearningService.class);
        }
        @Bean
        LearningRecords records() {
            return mock(LearningRecords.class);
        }
        @Bean
        ObjectMapper mapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
        @Bean
        LearningProperties properties() {
            return new LearningProperties(LearningService.token(), ISSUER, "learning-test", "", "");
        }
        @Bean
        ClientRegistrationRepository clients() {
            return new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("learning")
                    .clientId("learning-test").clientSecret(LearningService.token()).scope("openid", "profile")
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                    .authorizationUri(ISSUER + "/protocol/openid-connect/auth")
                    .tokenUri(ISSUER + "/protocol/openid-connect/token")
                    .jwkSetUri(ISSUER + "/protocol/openid-connect/certs")
                    .providerConfigurationMetadata(Map.of("end_session_endpoint", ISSUER + "/protocol/openid-connect/logout"))
                    .issuerUri(ISSUER).userNameAttributeName("sub").build());
        }
    }

    @Autowired
    WebApplicationContext context;
    @Autowired
    LearningService learning;
    @Autowired
    LearningProperties properties;
    @Autowired
    ClientRegistrationRepository clients;
    MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        reset(learning, context.getBean(LearningRecords.class));
    }

    @Test
    void businessApisRequireLoginAndCsrfAndRejectUnknownPaths() throws Exception {
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(get("/api/v1/capabilities")).andExpect(status().isOk()).andExpect(jsonPath("$.cloud").value(true));
        mvc.perform(get("/api/v1/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.token").isString());
        mvc.perform(post("/api/v1/families").with(oidcLogin()).contentType("application/json").content("{\"name\":\"synthetic\"}"))
                .andExpect(status().isForbidden());
        when(learning.createFamily(any(), any())).thenReturn(Map.of("id", "synthetic-family"));
        mvc.perform(post("/api/v1/families").with(oidcLogin()).with(csrf()).contentType("application/json").content("{\"name\":\"synthetic\"}"))
                .andExpect(status().isOk());
        mvc.perform(get("/private-configuration").with(oidcLogin())).andExpect(status().isForbidden());
    }

    @Test
    void practiceProfileRequiresLoginAndReturnsNoncacheableChildResource() throws Exception {
        var family = java.util.UUID.randomUUID();
        var child = java.util.UUID.randomUUID();
        String path = "/api/v1/families/" + family + "/children/" + child + "/practice-profile";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        when(context.getBean(LearningRecords.class).practiceProfile(any(), eq(family), eq(child))).thenReturn(Map.of("schema", 1, "topicIds", java.util.List.of()));
        mvc.perform(get(path).with(oidcLogin())).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.schema").value(1)).andExpect(jsonPath("$.topicIds").isEmpty());
        mvc.perform(get("/api/v1/capabilities")).andExpect(status().isOk()).andExpect(jsonPath("$.adaptivePractice").value(true));
    }

    @Test
    void registrationInternalEndpointsRequireIndependentSecret() throws Exception {
        mvc.perform(post("/internal/registration/reserve").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        when(learning.reserve(any())).thenReturn(Map.of("reservationId", "synthetic"));
        mvc.perform(post("/internal/registration/reserve").header("X-Registration-Key", properties.registrationKey()).contentType("application/json").content("{}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.reservationId").value("synthetic"));
    }

    @Test
    void registrationKeepsOAuthStateNonceAndAddsGate() throws Exception {
        String grant = LearningService.token();
        var response = mvc.perform(get("/oauth2/authorization/learning").param("invite_grant", grant)).andExpect(status().is3xxRedirection()).andReturn();
        String location = response.getResponse().getHeader("Location");
        assertNotNull(location);
        assertTrue(location.contains("/protocol/openid-connect/registrations?"));
        assertTrue(location.contains("invite_grant=" + grant));
        assertTrue(location.contains("state="));
        assertTrue(location.contains("nonce="));
        assertNotNull(response.getRequest().getSession(false));
        assertPkceAndTokenExchange(response);
        var normal = mvc.perform(get("/oauth2/authorization/learning")).andExpect(status().is3xxRedirection()).andReturn();
        assertTrue(normal.getResponse().getHeader("Location").contains("/protocol/openid-connect/auth?"));
        assertFalse(normal.getResponse().getHeader("Location").contains("invite_grant="));
        assertPkceAndTokenExchange(normal);
    }

    private void assertPkceAndTokenExchange(MvcResult result) throws Exception {
        String location = result.getResponse().getHeader("Location");
        var parameters = UriComponentsBuilder.fromUriString(location).build().getQueryParams();
        assertEquals("S256", parameters.getFirst("code_challenge_method"));
        assertNotNull(parameters.getFirst("code_challenge"));
        assertFalse(location.contains("code_verifier="));
        result.getRequest().addParameter("state", UriUtils.decode(parameters.getFirst("state"), StandardCharsets.UTF_8));
        var authorization = new HttpSessionOAuth2AuthorizationRequestRepository().loadAuthorizationRequest(result.getRequest());
        assertNotNull(authorization);
        String verifier = authorization.getAttribute("code_verifier");
        assertNotNull(verifier);
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        assertEquals(challenge, parameters.getFirst("code_challenge"));
        var code = OAuth2AuthorizationResponse.success("synthetic-code").state(authorization.getState()).redirectUri(authorization.getRedirectUri()).build();
        var grant = new OAuth2AuthorizationCodeGrantRequest(clients.findByRegistrationId("learning"), new OAuth2AuthorizationExchange(authorization, code));
        var tokenParameters = new DefaultOAuth2TokenRequestParametersConverter<OAuth2AuthorizationCodeGrantRequest>().convert(grant);
        assertEquals(verifier, tokenParameters.getFirst("code_verifier"));
    }

    @Test
    void securityHeadersAndWriteSizeAreEnforced() throws Exception {
        mvc.perform(get("/api/v1/capabilities")).andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().exists("Content-Security-Policy"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(post("/api/v1/invitations/preview").with(csrf()).contentType("application/json").content("x".repeat(1_048_577)))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    void returningHintIsPrivateUncachedAndCannotAuthenticateOrAuthorizeWrites() throws Exception {
        mvc.perform(get("/api/v1/capabilities"))
                .andExpect(header().string("Cache-Control", "no-store")).andExpect(header().string("Vary", "Cookie"))
                .andExpect(jsonPath("$.sessionRestoreUrl").doesNotExist());
        mvc.perform(get("/api/v1/capabilities").cookie(new Cookie(SessionRestoration.COOKIE, "invalid")))
                .andExpect(jsonPath("$.sessionRestoreUrl").doesNotExist());
        var forged = new Cookie(SessionRestoration.COOKIE, "1");
        mvc.perform(get("/api/v1/capabilities").cookie(forged))
                .andExpect(jsonPath("$.sessionRestoreUrl").value("oauth2/authorization/learning?restore=1"));
        mvc.perform(get("/api/v1/me").cookie(forged)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/families").cookie(forged).contentType("application/json").content("{\"name\":\"synthetic\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/families").cookie(forged).with(csrf()).contentType("application/json").content("{\"name\":\"synthetic\"}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(learning);
    }

    @Test
    void silentRestoreUsesStateNoncePkceAndFailureClearsHintWithoutLoop() throws Exception {
        var start = mvc.perform(get("/edu/math/oauth2/authorization/learning").contextPath("/edu/math")
                        .param("restore", "1").cookie(new Cookie(SessionRestoration.COOKIE, "1")))
                .andExpect(status().is3xxRedirection()).andReturn();
        var parameters = UriComponentsBuilder.fromUriString(start.getResponse().getRedirectedUrl()).build().getQueryParams();
        assertEquals("none", parameters.getFirst("prompt"));
        assertNotNull(parameters.getFirst("nonce"));
        assertPkceAndTokenExchange(start);
        mvc.perform(get("/edu/math/login/oauth2/code/learning").contextPath("/edu/math")
                        .session((MockHttpSession) start.getRequest().getSession(false))
                        .param("error", "login_required").param("state", UriUtils.decode(parameters.getFirst("state"), StandardCharsets.UTF_8)))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/edu/math/#family"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("LEARNING_RETURNING=;"), org.hamcrest.Matchers.containsString("Max-Age=0"),
                        org.hamcrest.Matchers.containsString("Path=/edu/math"), org.hamcrest.Matchers.containsString("Secure"),
                        org.hamcrest.Matchers.containsString("HttpOnly"), org.hamcrest.Matchers.containsString("SameSite=Lax"))));
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/capabilities")).andExpect(jsonPath("$.sessionRestoreUrl").doesNotExist());
    }

    @Test
    void ordinaryFailureAndInvalidRestoreStateNeverGrantIdentity() throws Exception {
        var start = mvc.perform(get("/oauth2/authorization/learning").param("restore", "1"))
                .andExpect(status().is3xxRedirection()).andReturn();
        mvc.perform(get("/login/oauth2/code/learning").session((MockHttpSession) start.getRequest().getSession(false))
                        .param("error", "login_required").param("state", "forged-state"))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/login?error"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        var ordinary = mvc.perform(get("/oauth2/authorization/learning")).andExpect(status().is3xxRedirection()).andReturn();
        var parameters = UriComponentsBuilder.fromUriString(ordinary.getResponse().getRedirectedUrl()).build().getQueryParams();
        assertNull(parameters.getFirst("prompt"));
        mvc.perform(get("/login/oauth2/code/learning").session((MockHttpSession) ordinary.getRequest().getSession(false))
                        .param("error", "access_denied").param("state", UriUtils.decode(parameters.getFirst("state"), StandardCharsets.UTF_8)))
                .andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/login?error"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        verifyNoInteractions(learning);
    }

    @Test
    void successfulLoginSetsThirtyDayHostOnlyHintAndExplicitLogoutClearsItAndSso() throws Exception {
        var request = new MockHttpServletRequest("GET", "/edu/math/login/oauth2/code/learning");
        request.setContextPath("/edu/math");
        var response = new MockHttpServletResponse();
        new SessionRestoration().onAuthenticationSuccess(request, response,
                UsernamePasswordAuthenticationToken.authenticated("synthetic", "unused", java.util.List.of()));
        assertEquals("/edu/math/", response.getRedirectedUrl());
        String cookie = response.getHeader("Set-Cookie");
        assertNotNull(cookie);
        assertTrue(cookie.contains("LEARNING_RETURNING=1;"));
        assertTrue(cookie.contains("Max-Age=2592000"));
        assertTrue(cookie.contains("Path=/edu/math"));
        assertTrue(cookie.contains("Secure"));
        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("SameSite=Lax"));
        assertFalse(cookie.contains("Domain="));
        assertFalse(cookie.contains("LEARNING_SESSION"));
        mvc.perform(post("/logout").with(oidcLogin().clientRegistration(clients.findByRegistrationId("learning"))).with(csrf())
                        .cookie(new Cookie(SessionRestoration.COOKIE, "1")))
                .andExpect(status().is3xxRedirection())
                .andExpect(result -> assertTrue(result.getResponse().getRedirectedUrl()
                        .startsWith(ISSUER + "/protocol/openid-connect/logout?id_token_hint=")))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.allOf(
                        org.hamcrest.Matchers.containsString("LEARNING_RETURNING=;"), org.hamcrest.Matchers.containsString("Max-Age=0"))));
    }

    @Test
    void restoreCannotMixWithRegistrationAndUnrecognizedPromptQueriesAreIgnored() throws Exception {
        var start = mvc.perform(get("/oauth2/authorization/learning").with(oidcLogin()).param("relogin", "1").param("prompt", "login"))
                .andExpect(status().is3xxRedirection()).andReturn();
        var parameters = UriComponentsBuilder.fromUriString(start.getResponse().getRedirectedUrl()).build().getQueryParams();
        assertNull(parameters.getFirst("prompt"));
        assertNotNull(parameters.getFirst("nonce"));
        assertPkceAndTokenExchange(start);
        var request = new MockHttpServletRequest("GET", "/oauth2/authorization/learning");
        request.addParameter("restore", "1");
        request.addParameter("invite_grant", LearningService.token());
        assertThrows(ApiException.class, () -> new InvitedRegistrationResolver(clients).resolve(request));
    }
}
