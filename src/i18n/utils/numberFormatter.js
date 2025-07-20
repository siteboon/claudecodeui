export function formatNumber(number, locale = 'en') {
  return new Intl.NumberFormat(locale).format(number);
}

export function formatCurrency(amount, currency = 'USD', locale = 'en') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(amount);
}

export function formatPercent(value, locale = 'en', decimals = 0) {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

export function formatFileSize(bytes, locale = 'en') {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, unitIndex);
  
  const formattedSize = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(size);
  
  return `${formattedSize} ${units[unitIndex]}`;
}

export function formatCompactNumber(number, locale = 'en') {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short'
  }).format(number);
}

export function formatOrdinal(number, locale = 'en') {
  if (locale === 'en') {
    const pr = new Intl.PluralRules('en-US', { type: 'ordinal' });
    const suffixes = {
      one: 'st',
      two: 'nd',
      few: 'rd',
      other: 'th'
    };
    const rule = pr.select(number);
    const suffix = suffixes[rule];
    return `${number}${suffix}`;
  }
  
  // For zh-TW, ordinals are typically expressed with 第 prefix
  if (locale === 'zh-TW') {
    return `第${number}`;
  }
  
  // Default to just the number for other locales
  return number.toString();
}