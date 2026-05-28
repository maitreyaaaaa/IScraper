const MONTH_INDEX = new Map([
  ['jan', 0],
  ['january', 0],
  ['feb', 1],
  ['february', 1],
  ['mar', 2],
  ['march', 2],
  ['apr', 3],
  ['april', 3],
  ['may', 4],
  ['jun', 5],
  ['june', 5],
  ['jul', 6],
  ['july', 6],
  ['aug', 7],
  ['august', 7],
  ['sep', 8],
  ['sept', 8],
  ['september', 8],
  ['oct', 9],
  ['october', 9],
  ['nov', 10],
  ['november', 10],
  ['dec', 11],
  ['december', 11],
]);

function validIsoFromDate(date) {
  const timestamp = date instanceof Date ? date.getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? date.toISOString() : '';
}

function parseInstagramHtmlDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (!match) return '';

  const month = MONTH_INDEX.get(match[1].toLowerCase());
  if (month == null) return '';

  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  const meridiem = match[7].toLowerCase();
  if (hour === 12) hour = 0;
  if (meridiem === 'pm') hour += 12;

  return validIsoFromDate(new Date(Date.UTC(
    Number(match[3]),
    month,
    Number(match[2]),
    hour,
    minute,
    second,
  )));
}

function normalizeSourceSavedAt(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const numeric = Number(text);
  if (/^\d{10}$/.test(text) && Number.isFinite(numeric)) {
    return validIsoFromDate(new Date(numeric * 1000));
  }
  if (/^\d{13}$/.test(text) && Number.isFinite(numeric)) {
    return validIsoFromDate(new Date(numeric));
  }

  const instagramDate = parseInstagramHtmlDate(text);
  if (instagramDate) return instagramDate;

  return validIsoFromDate(new Date(text));
}

function sourceSavedAtOrCreatedAt(item = {}) {
  return normalizeSourceSavedAt(item.savedAt) || normalizeSourceSavedAt(item.createdAt) || '';
}

function createdAtForImportedItem(item = {}, fallbackIso = new Date().toISOString()) {
  return sourceSavedAtOrCreatedAt(item) || fallbackIso;
}

module.exports = {
  createdAtForImportedItem,
  normalizeSourceSavedAt,
  sourceSavedAtOrCreatedAt,
};
