package org.cnmathtaxonomy.identity;

import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.keycloak.util.JsonSerialization;

class RegistrationGatewayTest {
    private static final String KEY = "synthetic-test-key-with-at-least-32-characters";

    @Test void invalidConfigurationFailsClosed() {
        for (String base : new String[]{"", "file:///tmp/test", "http://user:password@example.test", "http://example.test?x=1"})
            assertThrows(IllegalArgumentException.class, () -> new RegistrationGateway(base, KEY));
        assertThrows(IllegalArgumentException.class, () -> new RegistrationGateway("http://127.0.0.1", "short"));
    }

    @Test void receiptAuthenticatesReservationAndExactIdentity() throws Exception {
        var gateway = new RegistrationGateway("http://127.0.0.1", KEY);
        String receipt = gateway.receipt("reserved-1", "education-client", "session-1", "https://issuer.example.test/realm", "subject-1");
        String[] parts = receipt.split("\\.");
        assertEquals(2, parts.length);
        Map<?, ?> claims = JsonSerialization.readValue(Base64.getUrlDecoder().decode(parts[0]), Map.class);
        assertEquals(1, claims.get("v"));
        assertEquals("reserved-1", claims.get("reservationId"));
        assertEquals("subject-1", claims.get("subject"));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        assertArrayEquals(mac.doFinal(parts[0].getBytes(StandardCharsets.US_ASCII)), Base64.getUrlDecoder().decode(parts[1]));
        assertNotEquals(receipt, gateway.receipt("reserved-1", "education-client", "session-1", "https://issuer.example.test/realm", "subject-2"));
    }

    @Test void reserveAndBindSendOnlyContractFieldsAndRejectFailures() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/internal/registration/", exchange -> {
            assertEquals(KEY, exchange.getRequestHeaders().getFirst("X-Registration-Key"));
            Map<?, ?> payload = JsonSerialization.readValue(exchange.getRequestBody(), Map.class);
            assertFalse(payload.containsKey("password"));
            if (exchange.getRequestURI().getPath().endsWith("reserve")) {
                assertEquals(4, payload.size());
                assertEquals("test-client", payload.get("clientId"));
            } else {
                assertEquals(5, payload.size());
                assertEquals("test-subject", payload.get("subject"));
            }
            int count = calls.incrementAndGet();
            byte[] body = (count == 1 ? "{\"reservationId\":\"reservation-1\"}" : "{}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(count == 3 ? 503 : 200, body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        try {
            var gateway = new RegistrationGateway("http://127.0.0.1:" + server.getAddress().getPort(), KEY);
            assertEquals("reservation-1", gateway.reserve("opaque-grant", "test-client", "session-1", "synthetic"));
            gateway.bind("reservation-1", "test-client", "session-1", "https://issuer.example.test/realm", "test-subject");
            assertThrows(IOException.class, () -> gateway.reserve("opaque-grant", "test-client", "session-1", "synthetic"));
        } finally { server.stop(0); }
    }

    @Test void missingReservationAndRedirectAreRejected() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger calls = new AtomicInteger();
        server.createContext("/internal/registration/reserve", exchange -> {
            exchange.getRequestBody().close();
            int count = calls.incrementAndGet();
            byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
            if (count == 2) exchange.getResponseHeaders().set("Location", "http://127.0.0.1:1/untrusted");
            exchange.sendResponseHeaders(count == 2 ? 302 : 200, body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        try {
            var gateway = new RegistrationGateway("http://127.0.0.1:" + server.getAddress().getPort(), KEY);
            assertThrows(IOException.class, () -> gateway.reserve("grant", "client", "session", "user"));
            assertThrows(IOException.class, () -> gateway.reserve("grant", "client", "session", "user"));
            assertEquals(2, calls.get());
        } finally { server.stop(0); }
    }
}
