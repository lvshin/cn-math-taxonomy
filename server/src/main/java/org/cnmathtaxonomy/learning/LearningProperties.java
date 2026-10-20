package org.cnmathtaxonomy.learning;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("learning")
public record LearningProperties(String registrationKey, String oidcIssuer, String oidcClientId,
        String operatorIssuer, String operatorSubject) {
    public LearningProperties {
        if (registrationKey == null || registrationKey.length() < 32 || oidcIssuer == null || oidcIssuer.isBlank()
                || oidcClientId == null || oidcClientId.isBlank()) {
            throw new IllegalArgumentException("Required learning identity configuration is incomplete");
        }
        boolean issuerPresent = operatorIssuer != null && !operatorIssuer.isBlank();
        boolean subjectPresent = operatorSubject != null && !operatorSubject.isBlank();
        if (issuerPresent != subjectPresent) {
            throw new IllegalArgumentException("Operator issuer and subject must be configured together");
        }
    }

    @Override
    public String toString() {
        return "LearningProperties[protected configuration]";
    }
}
