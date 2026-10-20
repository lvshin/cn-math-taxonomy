-- Historical, inactive memberships and their authored records are retained. PostgreSQL
-- checks every row when building the index, including rows hidden by FORCE RLS. If an
-- existing account has several active families this migration fails transactionally;
-- an operator must resolve the memberships explicitly rather than delete learning data.
CREATE UNIQUE INDEX members_one_active_family ON learning.members(user_id) WHERE active;
