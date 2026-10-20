package org.cnmathtaxonomy.identity;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.keycloak.util.JsonSerialization;

/** Calls a private backend. It never receives passwords or logs grant values. */
final class RegistrationGateway {
    private final URI base;
    private final String key;
    private final HttpClient client;

    RegistrationGateway(String base, String key) {
        this.base = URI.create(base == null ? "" : base);
        if (!this.base.isAbsolute() || !("http".equals(this.base.getScheme()) || "https".equals(this.base.getScheme()))
                || this.base.getHost() == null || this.base.getUserInfo() != null
                || this.base.getRawQuery() != null || this.base.getRawFragment() != null
                || key == null || key.length() < 32) throw new IllegalArgumentException("Registration integration is not configured");
        this.key = key;
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    String reserve(String grant, String clientId, String authSessionId, String username) throws IOException, InterruptedException {
        String payload = post("reserve", Map.of("grant", grant, "clientId", clientId,
                "authSessionId", authSessionId, "username", username));
        var result = JsonSerialization.readValue(payload, Map.class);
        Object reservation = result.get("reservationId");
        if (!(reservation instanceof String text) || text.isBlank() || text.length() > 256)
            throw new IOException("Invalid registration reservation");
        return text;
    }

    void bind(String reservationId, String clientId, String authSessionId, String issuer, String subject)
            throws IOException, InterruptedException {
        post("bind", Map.of("reservationId", reservationId, "clientId", clientId,
                "authSessionId", authSessionId, "issuer", issuer, "subject", subject));
    }

    String receipt(String reservationId, String clientId, String authSessionId, String issuer, String subject) throws IOException {
        String json = JsonSerialization.writeValueAsString(Map.of("v", 1, "reservationId", reservationId,
                "clientId", clientId, "authSessionId", authSessionId, "issuer", issuer, "subject", subject));
        var encoder = Base64.getUrlEncoder().withoutPadding();
        String payload = encoder.encodeToString(json.getBytes(StandardCharsets.UTF_8));
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return payload + "." + encoder.encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.US_ASCII)));
        } catch (GeneralSecurityException unavailable) { throw new IOException("Registration receipt unavailable"); }
    }

    private String post(String operation, Map<String, String> body) throws IOException, InterruptedException {
        URI uri = URI.create(base.toString().replaceAll("/+$", "") + "/internal/registration/" + operation);
        var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json").header("Accept", "application/json")
                .header("X-Registration-Key", key)
                .POST(HttpRequest.BodyPublishers.ofString(JsonSerialization.writeValueAsString(body))).build();
        var response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300)
            throw new IOException("Registration integration rejected request");
        if (response.body().length() > 16_384) throw new IOException("Registration response is too large");
        return response.body();
    }
}
