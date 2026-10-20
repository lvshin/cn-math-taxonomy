import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** No credentials or application data are read by the container probe. */
public final class HealthCheck {
    public static void main(String[] args) {
        try {
            var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080/edu/math/readyz"))
                    .timeout(Duration.ofSeconds(5)).GET().build();
            System.exit(client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() == 200 ? 0 : 1);
        } catch (Exception exception) {
            System.exit(1);
        }
    }
}
