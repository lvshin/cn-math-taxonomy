CREATE SCHEMA learning;
CREATE FUNCTION learning.context(name text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('learning.' || name, true), '') $$;
CREATE FUNCTION learning.actor() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT learning.context('actor')::uuid $$;
CREATE FUNCTION learning.family() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT learning.context('family')::uuid $$;
CREATE FUNCTION learning.owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(learning.context('role') = 'OWNER', false) $$;
CREATE FUNCTION learning.writer() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(learning.context('role') IN ('OWNER','EDITOR'), false) $$;

CREATE TABLE learning.users (
 id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, name varchar(120) NOT NULL,
 enabled boolean NOT NULL DEFAULT true, create_allowed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE TABLE learning.families (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL, created_by uuid NOT NULL REFERENCES learning.users,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learning.members (
 family_id uuid NOT NULL REFERENCES learning.families, user_id uuid NOT NULL REFERENCES learning.users,
 role varchar(10) NOT NULL CHECK(role IN ('OWNER','EDITOR','VIEWER')),
 active boolean NOT NULL DEFAULT true, version bigint NOT NULL DEFAULT 0,
 joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(family_id,user_id)
);
CREATE INDEX members_user_active ON learning.members(user_id,family_id) WHERE active;
CREATE TABLE learning.children (
 id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES learning.families,
 nickname varchar(80) NOT NULL, stage varchar(80), archived boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(family_id,id)
);
CREATE TABLE learning.invitations (
 id uuid PRIMARY KEY, family_id uuid REFERENCES learning.families, role varchar(10) NOT NULL CHECK(role IN ('OWNER','EDITOR','VIEWER')),
 token_hash text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES learning.users,
 expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 accepted_by uuid REFERENCES learning.users, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learning.registration_grants (
 id uuid PRIMARY KEY, invitation_id uuid NOT NULL REFERENCES learning.invitations,
 grant_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 reservation_id uuid UNIQUE, client_id text, auth_session_id text, username text,
 bound_issuer text, bound_subject text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((bound_issuer IS NULL) = (bound_subject IS NULL))
);
CREATE UNIQUE INDEX one_registration_per_invitation ON learning.registration_grants(invitation_id) WHERE reservation_id IS NOT NULL;
CREATE TABLE learning.observations (
 id uuid PRIMARY KEY, family_id uuid NOT NULL, child_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES learning.users, activity_id varchar(100) NOT NULL,
 activity_version varchar(100) NOT NULL, outcome varchar(20) NOT NULL CHECK(outcome IN ('INDEPENDENT','PROMPTED','TOGETHER','NOT_TRIED','PAUSED')),
 note varchar(2000), occurred_at timestamptz NOT NULL, correction_of uuid,
 fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(family_id,child_id) REFERENCES learning.children(family_id,id),
 UNIQUE(family_id,child_id,id),
 FOREIGN KEY(family_id,child_id,correction_of) REFERENCES learning.observations(family_id,child_id,id)
);
CREATE TABLE learning.sessions (
 id uuid PRIMARY KEY, family_id uuid NOT NULL, child_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES learning.users, data_version varchar(100) NOT NULL,
 content_snapshot jsonb NOT NULL, snapshot jsonb NOT NULL, initial_fingerprint text NOT NULL,
 finished boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 0,
 occurred_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(family_id,child_id) REFERENCES learning.children(family_id,id), UNIQUE(family_id,child_id,id)
);
CREATE TABLE learning.imports (
 id uuid PRIMARY KEY, family_id uuid NOT NULL, child_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES learning.users,
 record jsonb NOT NULL, fingerprint text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(family_id,child_id) REFERENCES learning.children(family_id,id), UNIQUE(family_id,child_id,fingerprint)
);
CREATE TABLE learning.audit (
 id uuid PRIMARY KEY, family_id uuid REFERENCES learning.families, actor_id uuid NOT NULL REFERENCES learning.users,
 action varchar(100) NOT NULL, target_id uuid, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX observations_history ON learning.observations(family_id,child_id,occurred_at DESC,id DESC);
CREATE INDEX sessions_history ON learning.sessions(family_id,child_id,occurred_at DESC,id DESC);
CREATE INDEX imports_history ON learning.imports(family_id,child_id,occurred_at DESC,id DESC);

ALTER TABLE learning.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.users FORCE ROW LEVEL SECURITY;
CREATE POLICY own_identity ON learning.users USING (
 id=learning.actor() OR (issuer=learning.context('issuer') AND subject=learning.context('subject'))
 OR EXISTS(SELECT 1 FROM learning.members m WHERE m.user_id=users.id AND m.family_id=learning.family())
) WITH CHECK(id=learning.actor() OR (issuer=learning.context('issuer') AND subject=learning.context('subject')));
ALTER TABLE learning.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.families FORCE ROW LEVEL SECURITY;
CREATE POLICY family_access ON learning.families FOR SELECT USING(id=learning.family());
CREATE POLICY family_create ON learning.families FOR INSERT WITH CHECK(id=learning.family() AND created_by=learning.actor() AND learning.owner());
ALTER TABLE learning.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.members FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON learning.members FOR SELECT USING(user_id=learning.actor() OR family_id=learning.family());
CREATE POLICY membership_write ON learning.members FOR ALL USING(family_id=learning.family() AND learning.owner()) WITH CHECK(family_id=learning.family() AND learning.owner());
ALTER TABLE learning.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.children FORCE ROW LEVEL SECURITY;
CREATE POLICY child_read ON learning.children FOR SELECT USING(family_id=learning.family());
CREATE POLICY child_write ON learning.children FOR ALL USING(family_id=learning.family() AND learning.owner()) WITH CHECK(family_id=learning.family() AND learning.owner());
ALTER TABLE learning.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_access ON learning.invitations USING(
 (family_id=learning.family() AND learning.owner()) OR token_hash=learning.context('invite_hash')
 OR (family_id IS NULL AND learning.context('operator')='true')
 OR id::text=learning.context('invitation_id')
) WITH CHECK(
 (family_id=learning.family() AND learning.owner()) OR token_hash=learning.context('invite_hash')
 OR (family_id IS NULL AND learning.context('operator')='true')
);
ALTER TABLE learning.registration_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.registration_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY grant_access ON learning.registration_grants USING(
 grant_hash=learning.context('grant_hash') OR reservation_id::text=learning.context('reservation')
 OR invitation_id::text=learning.context('invitation_id')
) WITH CHECK(
 grant_hash=learning.context('grant_hash') OR reservation_id::text=learning.context('reservation')
 OR invitation_id::text=learning.context('invitation_id')
);
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['observations','sessions','imports'] LOOP
  EXECUTE format('ALTER TABLE learning.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE learning.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY learning_read ON learning.%I FOR SELECT USING(family_id=learning.family())',table_name);
  EXECUTE format('CREATE POLICY learning_insert ON learning.%I FOR INSERT WITH CHECK(family_id=learning.family() AND learning.writer() AND author_id=learning.actor())',table_name);
  EXECUTE format('CREATE POLICY learning_update ON learning.%I FOR UPDATE USING(family_id=learning.family() AND learning.writer() AND (author_id=learning.actor() OR learning.owner())) WITH CHECK(family_id=learning.family() AND learning.writer())',table_name);
 END LOOP;
END $$;
ALTER TABLE learning.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning.audit FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON learning.audit FOR SELECT USING(family_id=learning.family() AND learning.owner());
CREATE POLICY audit_write ON learning.audit FOR INSERT WITH CHECK(actor_id=learning.actor() AND (family_id=learning.family() OR (family_id IS NULL AND learning.context('operator')='true')));

-- The runtime role is provisioned separately without ownership, superuser or BYPASSRLS.
GRANT USAGE ON SCHEMA learning TO learning_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA learning TO learning_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA learning FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA learning TO learning_app;
REVOKE UPDATE ON learning.observations,learning.imports,learning.audit FROM learning_app;
