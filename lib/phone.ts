/**
 * Strips everything but digits, then drops a leading international "00"
 * prefix (the wire equivalent of a leading "+") — enough to match a
 * WhatsApp Cloud API `wa_id` (bare digits, country code, no punctuation)
 * against Lead.whatsapp regardless of how the latter was typed in
 * (+34 612 345 678, 0034612345678, 34612345678, ...). Returns '' when the
 * input has no digits at all.
 */
export function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}
