// Numeric controls stay numeric; accept a dictated expression rather than stripping words into guesses.
const words = Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety'.split(' ').map((w, i) => [w, i < 20 ? i : (i - 18) * 10]));
export function spokenNumber(text) {
  const literal = text.trim().replace(/^[\$£€]\s*/, '').replace(/[,.!?]+$/, '').replace(/(?: dollars?| percent|%)$/i, '').replaceAll(',', '');
  if (/^-?\d+(\.\d+)?$/.test(literal)) return literal;
  const tokens = literal.toLowerCase().split(/[\s-]+/).filter((s) => s && s !== 'and');
  let group = 0, total = 0, fraction = '', decimal = false, found = false, negative = false;
  if (tokens[0] === 'negative' || tokens[0] === 'minus') { tokens.shift(); negative = true; }
  for (const part of tokens) {
    if (part === 'point' && !decimal) { decimal = true; continue; }
    if (Object.hasOwn(words, part) || /^\d+$/.test(part)) {
      const number = words[part] ?? +part;
      if (decimal) { if (number > 9) return null; fraction += number; }
      else group += number;
      found = true;
    } else if (!decimal && group > 0 && part === 'hundred') group *= 100;
    else if (!decimal && group > 0 && (part === 'thousand' || part === 'million')) { total += group * (part === 'thousand' ? 1000 : 1000000); group = 0; }
    else return null;
  }
  return found && (!decimal || fraction !== '') ? (negative ? '-' : '') + (total + group) + (decimal ? '.' + fraction : '') : null;
}
