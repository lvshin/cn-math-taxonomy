package org.cnmathtaxonomy.learning;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.annotation.RollbackOn;

@SpringBootApplication
@EnableConfigurationProperties(LearningProperties.class)
@EnableTransactionManagement(rollbackOn = RollbackOn.ALL_EXCEPTIONS)
public class LearningApplication {
    public static void main(String[] args) {
        SpringApplication.run(LearningApplication.class, args);
    }
}
