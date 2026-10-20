-- SELECT FOR UPDATE also requires an UPDATE policy, even when the application only locks the row.
CREATE POLICY family_owner_lock ON learning.families FOR UPDATE
USING(id=learning.family() AND learning.owner()) WITH CHECK(id=learning.family() AND learning.owner());
