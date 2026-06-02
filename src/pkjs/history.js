var HISTORY_STORAGE_KEY = 'hermes-pebble-history';
var HISTORY_VERSION = 1;
var DEFAULT_MAX_ENTRIES = 10;
var MAX_ENTRIES_CAP = 20;
var PROMPT_STORE_MAX = 200;
var REPLY_STORE_MAX = 4096;
var LABEL_MAX = 28;

function pickString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function truncateText(text, maxLen) {
  text = pickString(text).replace(/\s+/g, ' ');
  if (text.length <= maxLen) {
    return text;
  }
  if (maxLen <= 1) {
    return text.substring(0, maxLen);
  }
  return text.substring(0, maxLen - 1) + '\u2026';
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || { version: HISTORY_VERSION, buckets: {} };
  } catch (err) {
    return { version: HISTORY_VERSION, buckets: {} };
  }
}

function saveStore(store) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(store));
}

function getHistorySettings(stored) {
  var enabled = true;
  if (stored) {
    var on = stored.HISTORY_ON;
    if (on === false || on === 0 || on === '0') {
      enabled = false;
    }
  }

  var maxEntries = parseInt(stored && stored.HISTORY_MAX, 10);
  if (!maxEntries || maxEntries < 1) {
    maxEntries = DEFAULT_MAX_ENTRIES;
  }
  if (maxEntries > MAX_ENTRIES_CAP) {
    maxEntries = MAX_ENTRIES_CAP;
  }

  return { enabled: enabled, maxEntries: maxEntries };
}

function entriesForSession(store, sessionKey) {
  var key = pickString(sessionKey) || 'pebble:default';
  if (!store.buckets[key]) {
    store.buckets[key] = [];
  }
  return store.buckets[key];
}

function appendExchange(sessionKey, prompt, reply, settings) {
  if (!settings || !settings.enabled) {
    return;
  }

  var store = loadStore();
  var entries = entriesForSession(store, sessionKey);
  var item = {
    id: String(Date.now()) + '-' + Math.floor(Math.random() * 100000),
    ts: Date.now(),
    prompt: truncateText(prompt, PROMPT_STORE_MAX),
    reply: truncateText(reply, REPLY_STORE_MAX)
  };

  entries.unshift(item);

  while (entries.length > settings.maxEntries) {
    entries.pop();
  }

  saveStore(store);
}

function listEntries(sessionKey) {
  var store = loadStore();
  return entriesForSession(store, sessionKey).slice();
}

function getEntry(sessionKey, index) {
  var entries = listEntries(sessionKey);
  if (index < 0 || index >= entries.length) {
    return null;
  }
  return entries[index];
}

function formatMenuLabel(entry, indexFromNewest) {
  var prompt = entry && entry.prompt ? entry.prompt : '';
  var label = truncateText(prompt, LABEL_MAX);
  if (!label.length) {
    label = '#' + String(indexFromNewest + 1);
  }
  return label;
}

function buildMenuLabelsString(sessionKey) {
  var entries = listEntries(sessionKey);
  var labels = [];
  var i;

  for (i = 0; i < entries.length; i += 1) {
    labels.push(formatMenuLabel(entries[i], i));
  }

  return labels.join('|');
}

module.exports = {
  getHistorySettings: getHistorySettings,
  appendExchange: appendExchange,
  listEntries: listEntries,
  getEntry: getEntry,
  buildMenuLabelsString: buildMenuLabelsString
};
