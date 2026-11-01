// Distances for the page. A pure function: also tested under node.

/** "350 m", "12.9 km" (or "12,9 km" in Portuguese), "451 km". */
export function distance(meters, lang = "en") {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  const digits = meters < 99_950 ? 1 : 0;
  const km = new Intl.NumberFormat(lang, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return `${km.format(meters / 1000)} km`;
}
