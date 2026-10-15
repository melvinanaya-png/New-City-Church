export function validateRecurrence(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value) || !['weekly','monthly'].includes(value.frequency)) return 'Choose a valid repeat schedule.';
  if (!Number.isInteger(value.interval) || !(value.frequency === 'weekly' ? [1,2] : [1]).includes(value.interval)) return 'Choose a valid repeat interval.';
  if (!Number.isInteger(value.count) || value.count < 2 || value.count > 104) return 'Enter 2–104 total occurrences, including the first event.';
}
export function recurrenceRule(date, recurrence) {
  if (!recurrence) return undefined;
  const error = validateRecurrence(recurrence); if (error) throw Error(error);
  const day = ['SU','MO','TU','WE','TH','FR','SA'][new Date(`${date}T12:00:00Z`).getUTCDay()];
  const timing = recurrence.frequency === 'weekly' ? `BYDAY=${day}` : `BYMONTHDAY=${Number(date.slice(8,10))}`;
  return `RRULE:FREQ=${recurrence.frequency.toUpperCase()};INTERVAL=${recurrence.interval};${timing};COUNT=${recurrence.count}`;
}
export function recurrenceSummary(date, recurrence) {
  if (!recurrence) return 'One-time event';
  const day = new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));
  const schedule = recurrence.frequency === 'weekly' ? `${recurrence.interval === 2 ? 'Every other' : 'Every'} ${day}` : `Monthly on day ${Number(date.slice(8,10))}`;
  return `${schedule} · ${recurrence.count} total occurrences (including the first)${recurrence.frequency === 'monthly' && Number(date.slice(8,10)) > 28 ? '; months without this day are skipped' : ''}`;
}
