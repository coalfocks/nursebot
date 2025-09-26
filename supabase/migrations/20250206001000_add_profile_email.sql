ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email text;

UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;

ALTER TABLE profiles
  ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_key
  ON profiles(email);
