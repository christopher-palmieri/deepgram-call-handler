# Phone Number Normalization

Utilities to normalize phone numbers to `(XXX) XXX-XXXX` format for maximum readability when Brandon speaks them.

## Why Normalize?

Brandon needs to read phone numbers out loud to clinic staff. The format `(XXX) XXX-XXXX` is:
- Most natural to speak: "area code six zero nine... five eight eight... six eight zero zero"
- Easy to visually parse
- Standard US phone number format

## Supported Input Formats

The normalizer handles all these formats:

```
(609) 588-6800  → (609) 588-6800
+16095886800    → (609) 588-6800
6095886800      → (609) 588-6800
609-588-6800    → (609) 588-6800
609.588.6800    → (609) 588-6800
1-609-588-6800  → (609) 588-6800
```

## Usage

### Option 1: SQL Function (For Existing Data)

Run the migration to normalize all existing phone numbers:

```bash
# Run the migration in Supabase SQL Editor or via CLI
psql -h your-db-host -U postgres -d postgres -f migrations/20250205-normalize-phone-numbers.sql
```

This creates a `normalize_phone_number()` function you can use in SQL:

```sql
-- Normalize a single phone number
SELECT normalize_phone_number('+16095886800');
-- Returns: (609) 588-6800

-- Update existing records
UPDATE pending_calls
SET employee_phone_number = normalize_phone_number(employee_phone_number)
WHERE employee_phone_number IS NOT NULL;
```

### Option 2: JavaScript Function (For Import Scripts)

Use in your import scripts:

```javascript
const { normalizePhoneNumber, normalizePhoneNumbersInRecord } = require('./utils/phone-normalizer.js');

// Normalize a single phone number
const normalized = normalizePhoneNumber('+16095886800');
console.log(normalized); // (609) 588-6800

// Normalize phone numbers in a record before inserting
const record = {
  employee_name: 'John Doe',
  employee_phone_number: '+16095886800',
  phone: '6095886800'
};

const normalizedRecord = normalizePhoneNumbersInRecord(record, ['employee_phone_number', 'phone']);
console.log(normalizedRecord);
// {
//   employee_name: 'John Doe',
//   employee_phone_number: '(609) 588-6800',
//   phone: '(609) 588-6800'
// }
```

### Option 3: CSV Import with Normalization

```javascript
const fs = require('fs');
const csv = require('csv-parser');
const { normalizePhoneNumbersInRecord } = require('./utils/phone-normalizer.js');

const records = [];

fs.createReadStream('import.csv')
  .pipe(csv())
  .on('data', (row) => {
    // Normalize phone numbers in each row
    const normalized = normalizePhoneNumbersInRecord(row, ['employee_phone_number']);
    records.push(normalized);
  })
  .on('end', () => {
    console.log(`Processed ${records.length} records`);
    // Insert into database...
  });
```

### Option 4: Database Trigger (Automatic Normalization)

Set up a trigger to automatically normalize phone numbers on insert/update:

```sql
-- Create trigger function
CREATE OR REPLACE FUNCTION auto_normalize_phone_numbers()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize employee_phone_number if provided
  IF NEW.employee_phone_number IS NOT NULL THEN
    NEW.employee_phone_number := normalize_phone_number(NEW.employee_phone_number);
  END IF;

  -- Normalize phone if provided
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := normalize_phone_number(NEW.phone);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER normalize_phones_before_insert_or_update
  BEFORE INSERT OR UPDATE ON pending_calls
  FOR EACH ROW
  EXECUTE FUNCTION auto_normalize_phone_numbers();
```

Now all phone numbers will be automatically normalized when inserted or updated!

## Testing

Test the JavaScript function:

```bash
node utils/phone-normalizer.js
```

This will run test cases and show the normalization results.

## Notes

- The normalizer expects US phone numbers (10 digits)
- Country code +1 is automatically removed
- Invalid formats (not 10 digits) return the original value
- NULL or empty values return NULL
- Brandon will read these as: "area code X X X... X X X... X X X X"
