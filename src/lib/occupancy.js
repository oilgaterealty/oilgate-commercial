export function breakEvenCount(result) {
  const units = result.operating.b.units;
  if (!(units > 0) || !Number.isFinite(result.breakEven)) return 'Count unavailable';
  const needed = Math.max(0, Math.ceil(result.breakEven * units - 1e-9));
  return `${needed} of ${units} units${needed > units ? ' · exceeds capacity' : ''}`;
}
