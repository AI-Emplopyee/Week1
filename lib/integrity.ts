/** Exact decimal arithmetic for factual checks. Values are never written back over source text. */
export type ExactDecimal = { coefficient: bigint; scale: number };

export function parseExactDecimal(raw: string, options: { signed?: boolean; integer?: boolean } = {}): ExactDecimal | undefined {
  // Resource bound, not a currency-specific precision or legal field constraint.
  if (typeof raw !== 'string' || raw.length > 1000) return undefined;
  const pattern = options.integer ? (options.signed ? /^-?\d+$/ : /^\d+$/) : (options.signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/);
  if (!pattern.test(raw)) return undefined;
  const [whole, fraction = ''] = raw.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length };
}
const pow10 = (scale: number) => BigInt(10) ** BigInt(scale);
function aligned(a: ExactDecimal, b: ExactDecimal) {
  const scale = Math.max(a.scale, b.scale);
  return { a: a.coefficient * pow10(scale - a.scale), b: b.coefficient * pow10(scale - b.scale), scale };
}
export function compareDecimal(a: ExactDecimal, b: ExactDecimal): -1 | 0 | 1 {
  const values = aligned(a, b); return values.a < values.b ? -1 : values.a > values.b ? 1 : 0;
}
export function addDecimal(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const values = aligned(a, b); return { coefficient: values.a + values.b, scale: values.scale };
}
export function multiplyDecimal(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
}
export function formatDecimal(value: ExactDecimal): string {
  const negative = value.coefficient < BigInt(0);
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, '0');
  const formatted = value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}` : digits;
  return (negative ? '-' : '') + formatted;
}
export function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const year = Number(raw.slice(0, 4)), month = Number(raw.slice(5, 7)), day = Number(raw.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
