ARG JAVA_RUNTIME=eclipse-temurin:25-jre
FROM ${JAVA_RUNTIME}
WORKDIR /app
COPY deploy/.build/HealthCheck.class /app/health/HealthCheck.class
COPY server/target/family-learning-server.jar /app/server.jar
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 CMD ["java", "-Xms8m", "-Xmx32m", "-cp", "/app/health", "HealthCheck"]
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-Djava.io.tmpdir=/tmp", "-jar", "/app/server.jar"]
