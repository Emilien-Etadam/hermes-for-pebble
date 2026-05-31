var Clay = require('pebble-clay');
var clayConfig = require('./config');
var customClay = require('./custom-clay');
var clay = new Clay(clayConfig, customClay, { autoHandleEvents: false });

var CHUNK_BYTES = 200;
var CHAT_TIMEOUT_MS = 180000;
var DEFAULT_MODEL = 'hermes';
var DEFAULT_SESSION_KEY = 'pebble:default';
var CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

var pendingChunks = [];
var chunkIndex = 0;
var chunkRetries = 0;

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) {
    return;
  }
  clay.getSettings(e.response);
  ensureConfigDefaults();
});

function pickString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function getStoredSettings() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (err) {
    stored = {};
  }
  return stored;
}

function saveStoredSettings(stored) {
  localStorage.setItem('clay-settings', JSON.stringify(stored));
}

function migrateLegacySettings(stored) {
  var changed = false;

  if (!pickString(stored.HERMES_SERVER) && pickString(stored.PAIRING_SERVER)) {
    stored.HERMES_SERVER = pickString(stored.PAIRING_SERVER);
    delete stored.PAIRING_SERVER;
    changed = true;
  }

  if (!pickString(stored.HERMES_KEY) && pickString(stored.PAIRING_KEY)) {
    stored.HERMES_KEY = pickString(stored.PAIRING_KEY);
    delete stored.PAIRING_KEY;
    changed = true;
  }

  return changed;
}

function getConfig() {
  var stored = getStoredSettings();
  migrateLegacySettings(stored);

  return {
    HERMES_SERVER: pickString(stored.HERMES_SERVER),
    HERMES_KEY: pickString(stored.HERMES_KEY),
    SESSION_KEY: pickString(stored.SESSION_KEY),
    MODEL: pickString(stored.MODEL)
  };
}

function getServerBase(server) {
  if (!server) {
    return '';
  }

  var base = server.replace(/\/+$/, '');
  if (base.indexOf('://') === -1) {
    base = 'http://' + base;
  }
  return base.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, '');
}

function resolveHermesRequest(config) {
  var base = getServerBase(config.HERMES_SERVER);
  return {
    url: base ? base + CHAT_COMPLETIONS_PATH : '',
    key: pickString(config.HERMES_KEY),
    model: pickString(config.MODEL) || DEFAULT_MODEL,
    sessionKey: pickString(config.SESSION_KEY) || DEFAULT_SESSION_KEY
  };
}

function isConfigured(config) {
  var request = resolveHermesRequest(config);
  return request.url.length > 0 && request.key.length > 0;
}

function ensureConfigDefaults() {
  var stored = getStoredSettings();
  var changed = migrateLegacySettings(stored);

  if (!pickString(stored.MODEL)) {
    stored.MODEL = DEFAULT_MODEL;
    changed = true;
  }

  if (!pickString(stored.SESSION_KEY)) {
    stored.SESSION_KEY = DEFAULT_SESSION_KEY;
    changed = true;
  }

  if (changed) {
    saveStoredSettings(stored);
  }
}

function utf8CodePointByteLength(codePoint) {
  return unescape(encodeURIComponent(codePoint)).length;
}

function splitReplyIntoChunks(text) {
  var chunks = [];
  var current = '';
  var currentBytes = 0;

  for (var codePoint of text) {
    var cpBytes = utf8CodePointByteLength(codePoint);

    if (currentBytes > 0 && currentBytes + cpBytes > CHUNK_BYTES) {
      chunks.push(current);
      current = codePoint;
      currentBytes = cpBytes;
    } else {
      current += codePoint;
      currentBytes += cpBytes;
    }
  }

  if (current.length > 0 || !chunks.length) {
    chunks.push(current);
  }

  return chunks;
}

function sendStatus(message) {
  Pebble.sendAppMessage({ STATUS: message }, null, function (err) {
    console.log('Failed to send STATUS: ' + JSON.stringify(err));
  });
}

function sendNextChunk() {
  if (chunkIndex >= pendingChunks.length) {
    Pebble.sendAppMessage({ REPLY_DONE: 1 }, null, function (err) {
      console.log('Failed to send REPLY_DONE: ' + JSON.stringify(err));
      sendStatus('Erreur envoi réponse');
    });
    return;
  }

  Pebble.sendAppMessage({ REPLY_CHUNK: pendingChunks[chunkIndex] }, function () {
    chunkIndex += 1;
    chunkRetries = 0;
    sendNextChunk();
  }, function (err) {
    console.log('Failed to send REPLY_CHUNK: ' + JSON.stringify(err));
    if (chunkRetries < 2) {
      chunkRetries += 1;
      sendNextChunk();
      return;
    }
    sendStatus('Transfert interrompu');
  });
}

function sendReplyChunks(text) {
  pendingChunks = splitReplyIntoChunks(text);
  chunkIndex = 0;
  chunkRetries = 0;
  sendNextChunk();
}

function extractReplyBody(responseText) {
  var data = JSON.parse(responseText);
  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message.content || '';
  }
  if (typeof data.output_text === 'string') {
    return data.output_text;
  }
  throw new Error('Missing reply content');
}

function queryHermes(prompt, config) {
  var request = resolveHermesRequest(config);
  var xhr = new XMLHttpRequest();

  sendStatus('Hermes réfléchit...');
  console.log('Hermes POST ' + request.url + ' model=' + request.model);

  xhr.open('POST', request.url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + request.key);
  xhr.setRequestHeader('X-Hermes-Session-Key', request.sessionKey);

  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        sendReplyChunks(extractReplyBody(xhr.responseText));
      } catch (err) {
        console.log('Invalid Hermes response: ' + err);
        sendStatus('Réponse invalide');
      }
      return;
    }

    if (xhr.status === 401) {
      sendStatus('Clé API invalide');
      return;
    }

    sendStatus('Erreur HTTP ' + xhr.status);
  };

  xhr.timeout = CHAT_TIMEOUT_MS;

  xhr.ontimeout = function () {
    sendStatus('Timeout Hermes (>3 min)');
  };

  xhr.onerror = function () {
    sendStatus('Hermes injoignable');
  };

  xhr.send(JSON.stringify({
    model: request.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false
  }));
}

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload;
  if (!payload || !payload.PROMPT) {
    return;
  }

  var config = getConfig();
  if (!isConfigured(config)) {
    sendStatus('Settings requis');
    return;
  }

  queryHermes(payload.PROMPT, config);
});

Pebble.addEventListener('ready', function () {
  ensureConfigDefaults();
  console.log('Hermes for Pebble ready');
});
