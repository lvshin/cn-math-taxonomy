-- Retain reservation IDs for identities already committed at the provider, even after a browser abandons its grant.
ALTER TABLE learning.registration_grants ADD COLUMN retired boolean NOT NULL DEFAULT false;
DROP INDEX learning.one_registration_per_invitation;
CREATE UNIQUE INDEX one_active_registration_per_invitation ON learning.registration_grants(invitation_id)
WHERE reservation_id IS NOT NULL AND NOT retired;
CREATE UNIQUE INDEX one_bound_registration_per_invitation ON learning.registration_grants(invitation_id)
WHERE bound_subject IS NOT NULL;
