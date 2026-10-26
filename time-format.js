// Format stored local clock times for email without shifting their time zone.
export function formatTime(time) {
  if(typeof time!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return time || '';
  const [hour,minute]=time.split(':');
  return `${Number(hour)%12 || 12}:${minute} ${Number(hour)<12?'AM':'PM'}`;
}
export function emailTimeRange(start,end) {
  return `${formatTime(start)}–${formatTime(end)} Central Time`;
}
