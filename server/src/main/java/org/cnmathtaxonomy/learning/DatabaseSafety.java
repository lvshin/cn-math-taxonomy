package org.cnmathtaxonomy.learning;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class DatabaseSafety implements ApplicationRunner {
    private final JdbcTemplate jdbc;

    DatabaseSafety(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    void verify() {
        Integer version = jdbc.queryForObject("SELECT current_setting('server_version_num')::integer", Integer.class);
        Boolean unsafeRole = jdbc.queryForObject("SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR pg_has_role(current_user,'learning_backup','MEMBER') FROM pg_roles WHERE rolname=current_user", Boolean.class);
        Integer unsafeTables = jdbc.queryForObject("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='learning' AND c.relkind='r' AND (pg_has_role(current_user,c.relowner,'MEMBER') OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity)", Integer.class);
        Integer tableCount = jdbc.queryForObject("SELECT count(*) FROM pg_tables WHERE schemaname='learning'", Integer.class);
        Boolean access = jdbc.queryForObject("SELECT has_schema_privilege(current_user,'learning','USAGE') AND has_table_privilege(current_user,'learning.members','SELECT') AND has_table_privilege(current_user,'learning.sessions','INSERT,UPDATE,SELECT')", Boolean.class);
        if (version == null || version < 180000 || version >= 190000 || Boolean.TRUE.equals(unsafeRole) || unsafeTables == null || unsafeTables != 0 || tableCount == null || tableCount < 10 || !Boolean.TRUE.equals(access)) {
            throw new IllegalStateException("PostgreSQL 18 and an isolated non-owner RLS runtime role are required");
        }
    }

    @Override
    public void run(ApplicationArguments args) {
        verify();
    }
}
