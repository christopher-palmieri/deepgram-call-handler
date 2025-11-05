/**
 * Phone Number Normalization Utility
 * Converts various phone number formats to (XXX) XXX-XXXX for readability
 *
 * Handles formats:
 * - (XXX) XXX-XXXX (already normalized)
 * - +1XXXXXXXXXX (with country code)
 * - XXXXXXXXXX (10 digits)
 * - XXX-XXX-XXXX
 * - XXX.XXX.XXXX
 * - Any format with 10-11 digits
 */

/**
 * Normalize a phone number to (XXX) XXX-XXXX format
 * @param {string} phone - Phone number in any format
 * @returns {string|null} - Formatted phone number or null if invalid
 */
function normalizePhoneNumber(phone) {
  // Return null for empty/null input
  if (!phone || phone.trim() === '') {
    return null;
  }

  // Extract only digits
  const digitsOnly = phone.replace(/\D/g, '');

  // Handle +1 country code (11 digits starting with 1)
  let cleanDigits = digitsOnly;
  if (digitsOnly.length === 11 && digitsOnly[0] === '1') {
    cleanDigits = digitsOnly.substring(1);
  }

  // Must be exactly 10 digits for US phone number
  if (cleanDigits.length !== 10) {
    console.warn(`Invalid phone number (not 10 digits): ${phone}`);
    return phone; // Return original if invalid
  }

  // Format as (XXX) XXX-XXXX
  const areaCode = cleanDigits.substring(0, 3);
  const prefix = cleanDigits.substring(3, 6);
  const lineNumber = cleanDigits.substring(6, 10);

  return `(${areaCode}) ${prefix}-${lineNumber}`;
}

/**
 * Batch normalize an array of phone numbers
 * @param {Array<string>} phones - Array of phone numbers
 * @returns {Array<string|null>} - Array of formatted phone numbers
 */
function normalizePhoneNumbers(phones) {
  return phones.map(normalizePhoneNumber);
}

/**
 * Normalize phone numbers in an object (useful for CSV/JSON imports)
 * @param {Object} record - Record object with phone fields
 * @param {Array<string>} phoneFields - Array of field names that contain phone numbers
 * @returns {Object} - Record with normalized phone numbers
 */
function normalizePhoneNumbersInRecord(record, phoneFields = ['phone', 'employee_phone_number']) {
  const normalized = { ...record };

  phoneFields.forEach(field => {
    if (normalized[field]) {
      normalized[field] = normalizePhoneNumber(normalized[field]);
    }
  });

  return normalized;
}

// Example usage
if (require.main === module) {
  // Test cases
  const testNumbers = [
    '(609) 588-6800',
    '+16095886800',
    '6095886800',
    '609-588-6800',
    '609.588.6800',
    '1-609-588-6800',
    'invalid',
    '',
    null
  ];

  console.log('Phone Number Normalization Tests:\n');
  testNumbers.forEach(num => {
    const normalized = normalizePhoneNumber(num);
    console.log(`Input:  "${num}"`);
    console.log(`Output: "${normalized}"\n`);
  });
}

module.exports = {
  normalizePhoneNumber,
  normalizePhoneNumbers,
  normalizePhoneNumbersInRecord
};
