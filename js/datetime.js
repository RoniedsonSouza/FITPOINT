(function (global) {
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function extractWallClock(value) {
    if (value == null || value === '') return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
        hour: value.getUTCHours(),
        minute: value.getUTCMinutes(),
        second: value.getUTCSeconds()
      };
    }

    const s = String(value).trim();
    const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (naive && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
      return {
        year: Number(naive[1]),
        month: Number(naive[2]),
        day: Number(naive[3]),
        hour: Number(naive[4]),
        minute: Number(naive[5]),
        second: Number(naive[6] || 0)
      };
    }

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    };
  }

  function formatTimestampPtBR(value, options) {
    const wc = extractWallClock(value);
    if (!wc) return '—';
    const opts = options || {};
    const d = new Date(Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second));
    return d.toLocaleString('pt-BR', {
      timeZone: 'UTC',
      dateStyle: opts.dateStyle || 'long',
      timeStyle: opts.timeStyle || 'short'
    });
  }

  function toDatetimeLocalValue(value) {
    const wc = extractWallClock(value);
    if (!wc) return '';
    return `${wc.year}-${pad2(wc.month)}-${pad2(wc.day)}T${pad2(wc.hour)}:${pad2(wc.minute)}`;
  }

  global.FitPointDatetime = {
    extractWallClock,
    formatTimestampPtBR,
    toDatetimeLocalValue
  };
})(typeof window !== 'undefined' ? window : globalThis);
