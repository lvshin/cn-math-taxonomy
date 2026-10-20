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
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationExchange;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationResponse;
import org.springframework.test.context.junit.jupiter.web.SpringJUnitWebConfig;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
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
        reset(learning);
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
}
