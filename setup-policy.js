export function setupResponsibility(record) {
  return record.eventType === 'internal'
    ? 'Internal church event: church staff will arrange setup help separately. This form does not assign a setup volunteer. Coordinate cleanup and room restoration with the church.'
    : 'Outside event: the requester is responsible for setup, teardown, cleaning and room restoration. The church does not provide setup services for outside events.';
}
