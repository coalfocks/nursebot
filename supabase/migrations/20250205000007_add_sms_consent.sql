-- Add SMS consent field to profiles table
ALTER TABLE profiles
ADD COLUMN sms_consent boolean DEFAULT false;

-- Add comment explaining the field
COMMENT ON COLUMN profiles.sms_consent IS 'Whether the user has consented to receive SMS notifications'; 