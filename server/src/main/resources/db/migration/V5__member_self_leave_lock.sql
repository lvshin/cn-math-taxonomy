-- Members need a row lock to leave safely; WITH CHECK(false) grants no ability to update family data.
CREATE POLICY family_member_lock ON learning.families FOR UPDATE
USING(id=learning.family() AND learning.context('role') IN ('OWNER','EDITOR','VIEWER')) WITH CHECK(false);
