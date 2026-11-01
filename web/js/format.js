// Durations, times of day and distances for the page. Pure functions: also tested under node.

/** "45 min", "1h05": the same style as the command line. */
export function duration(seconds) {
  const total = Math.round(seconds / 60);
  const [hours, minutes] = [Math.floor(total / 60), total % 60];
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

/** "HH:MM" -> minutes since midnight (null if it isn't a time). */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text ?? "");
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The time of day `seconds` after `startMinutes`: "14:05", or "00:40 +1" past midnight. */
export function clock(startMinutes, seconds) {
  const total = startMinutes + Math.round(seconds / 60);
  const days = Math.floor(total / 1440);
  const [hours, minutes] = [Math.floor((total % 1440) / 60), total % 60];
  const text = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return days ? `${text} +${days}` : text;
}

/** "350 m", "1.2 km" (or "1,2 km" in Portuguese), "451 km". */
export function distance(meters, lang = "en") {
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  const digits = meters < 9950 ? 1 : 0;
  const km = new Intl.NumberFormat(lang, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return `${km.format(meters / 1000)} km`;
}

/** The current time rounded up to the next 5 minutes, as "HH:MM". */
export function nowRounded(date = new Date()) {
  const minutes = Math.ceil((date.getHours() * 60 + date.getMinutes()) / 5) * 5;
  return clock(0, Math.min(minutes, 1435) * 60);
}
