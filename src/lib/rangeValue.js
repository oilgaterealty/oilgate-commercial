export function rangeValue(mr, rent) {
  if (!mr || !(mr.capRate > 0)) return 0;
  const rentMo = mr.units * rent * (1 - mr.vacancyPct / 100);
  return Math.max(0, ((rentMo - mr.costsMo) * 12) / (mr.capRate / 100));
}

