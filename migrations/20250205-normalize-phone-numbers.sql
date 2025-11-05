-- Normalize phone numbers in pending_calls to (XXX) XXX-XXXX format
-- This handles various input formats: +1XXXXXXXXXX, XXXXXXXXXX, (XXX) XXX-XXXX, etc.

-- Create a function to normalize phone numbers
CREATE OR REPLACE FUNCTION normalize_phone_number(phone_input TEXT)
RETURNS TEXT AS $$
DECLARE
  digits_only TEXT;
  normalized TEXT;
BEGIN
  -- Return NULL if input is NULL or empty
  IF phone_input IS NULL OR phone_input = '' THEN
    RETURN NULL;
  END IF;

  -- Extract only digits
  digits_only := regexp_replace(phone_input, '[^0-9]', '', 'g');

  -- Handle +1 country code (11 digits)
  IF length(digits_only) = 11 AND left(digits_only, 1) = '1' THEN
    digits_only := substring(digits_only from 2);
  END IF;

  -- Must be exactly 10 digits for US phone number
  IF length(digits_only) != 10 THEN
    -- If invalid, return original input
    RETURN phone_input;
  END IF;

  -- Format as (XXX) XXX-XXXX
  normalized := '(' || substring(digits_only from 1 for 3) || ') ' ||
                substring(digits_only from 4 for 3) || '-' ||
                substring(digits_only from 7 for 4);

  RETURN normalized;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update existing phone numbers in pending_calls
UPDATE pending_calls
SET employee_phone_number = normalize_phone_number(employee_phone_number)
WHERE employee_phone_number IS NOT NULL
  AND employee_phone_number != normalize_phone_number(employee_phone_number);

-- Show how many records were updated
SELECT
  COUNT(*) as total_records,
  COUNT(employee_phone_number) as records_with_phone,
  COUNT(CASE WHEN employee_phone_number ~ '^\(\d{3}\) \d{3}-\d{4}$' THEN 1 END) as normalized_format
FROM pending_calls;

COMMENT ON FUNCTION normalize_phone_number IS 'Normalizes phone numbers to (XXX) XXX-XXXX format for readability';
