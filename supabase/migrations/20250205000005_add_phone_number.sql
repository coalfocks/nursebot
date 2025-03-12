-- Add phone_number column to profiles table
ALTER TABLE profiles
ADD COLUMN phone_number text;

-- Add comment explaining the field
COMMENT ON COLUMN profiles.phone_number IS 'User phone number for SMS notifications'; 