package org.cnmathtaxonomy.learning;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class LearningStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    LearningStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    void context(String key, Object value) {
        jdbc.queryForObject("SELECT set_config(?, ?, true)", String.class, "learning." + key, value == null ? "" : value.toString());
    }

    List<Map<String, Object>> list(String sql, Object... args) {
        return jdbc.query(sql, this::mapRow, args);
    }

    /** Consume rows on the target bean so JDBC state is never read from an AOP proxy instance. */
    void forEachRow(String sql, Consumer<Map<String, Object>> consumer, Object... args) {
        jdbc.query(connection -> {
            var statement = connection.prepareStatement(sql);
            for (int i = 0; i < args.length; i++) {
                statement.setObject(i + 1, args[i]);
            }
            statement.setFetchSize(128);
            return statement;
        }, (org.springframework.jdbc.core.RowCallbackHandler) row -> consumer.accept(mapRow(row, 0)));
    }

    int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    Map<String, Object> one(String sql, Object... args) {
        var rows = list(sql, args);
        if (rows.isEmpty()) {
            throw ApiException.missing();
        }
        return rows.getFirst();
    }

    Map<String, Object> optional(String sql, Object... args) {
        var rows = list(sql, args);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    int update(String sql, Object... args) {
        return jdbc.update(sql, args);
    }

    void audit(UUID family, UUID actor, String action, UUID target) {
        update("INSERT INTO learning.audit(id,family_id,actor_id,action,target_id) VALUES(?,?,?,?,?)", UUID.randomUUID(), family, actor, action, target);
    }

    private Map<String, Object> mapRow(ResultSet rs, int row) throws SQLException {
        Map<String, Object> result = new LinkedHashMap<>();
        ResultSetMetaData meta = rs.getMetaData();
        for (int i = 1; i <= meta.getColumnCount(); i++) {
            Object value = rs.getObject(i);
            if (value instanceof Timestamp timestamp) {
                value = timestamp.toInstant();
            } else if (value != null && ("jsonb".equals(meta.getColumnTypeName(i)) || "json".equals(meta.getColumnTypeName(i)))) {
                try {
                    value = mapper.readTree(rs.getString(i));
                } catch (JsonProcessingException exception) {
                    throw new SQLException("Stored JSON is invalid", exception);
                }
            }
            result.put(camel(meta.getColumnLabel(i)), value);
        }
        return result;
    }

    private String camel(String name) {
        StringBuilder output = new StringBuilder();
        boolean uppercase = false;
        for (char c : name.toCharArray()) {
            if (c == '_') {
                uppercase = true;
            } else {
                output.append(uppercase ? Character.toUpperCase(c) : c);
                uppercase = false;
            }
        }
        return output.toString();
    }
}
