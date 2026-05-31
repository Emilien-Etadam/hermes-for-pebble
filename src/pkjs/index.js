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
  if (migrateLegacySettings(stored)) {
    saveStoredSettings(stored);
  }

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
  text = String(text || '');
  var chunks = [];
  var current = '';
  var currentBytes = 0;
  var i = 0;

  while (i < text.length) {
    var codePoint = text.charAt(i);

    if (text.charCodeAt(i) >= 0xD800 && text.charCodeAt(i) <= 0xDBFF && i + 1 < text.length) {
      var next = text.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        codePoint = text.charAt(i) + text.charAt(i + 1);
        i += 1;
      }
    }

    var cpBytes = utf8CodePointByteLength(codePoint);

    if (currentBytes > 0 && currentBytes + cpBytes > CHUNK_BYTES) {
      chunks.push(current);
      current = codePoint;
      currentBytes = cpBytes;
    } else {
      current += codePoint;
      currentBytes += cpBytes;
    }

    i += 1;
  }

  if (current.length > 0 || !chunks.length) {
    chunks.push(current);
  }

  return chunks;
}

function normalizeReplyContent(content) {
  if (content === null || content === undefined) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    var parts = [];
    for (var i = 0; i < content.length; i += 1) {
      var part = content[i];
      if (typeof part === 'string' && part) {
        parts.push(part);
      } else if (part && typeof part === 'object') {
        if (typeof part.text === 'string' && part.text) {
          parts.push(part.text);
        } else if (part.type === 'text' && typeof part.content === 'string') {
          parts.push(part.content);
        }
      }
    }
    return parts.join('\n');
  }

  return String(content);
}

function extractReplyBody(responseText) {
  if (!responseText) {
    throw new Error('Réponse vide');
  }

  if (responseText.indexOf('data:') === 0) {
    throw new Error('Stream non supporté');
  }

  var data = JSON.parse(responseText);

  if (data.error) {
    var errorMessage = data.error.message || data.error.code || 'Erreur Hermes';
    throw new Error(errorMessage);
  }

  if (data.choices && data.choices.length > 0) {
    var choice = data.choices[0];
    if (choice.message) {
      return normalizeReplyContent(choice.message.content);
    }
    if (typeof choice.text === 'string') {
      return choice.text;
    }
  }

  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  throw new Error('Missing reply content');
}

function sendStatus(message) {
  Pebble.sendAppMessage({ STATUS: message }, null, function (err) {
    console.log('Failed to send STATUS: ' + JSON.stringify(err));
  });
}

function sendNextChunk() {
  if (chunkIndex >= pendingChunks.length) {
    Pebble.sendAppMessage({ REPLY_DONE: 1 }, function () {
      sendStatus('SELECT parler');
    }, function (err) {
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
  var reply = String(text || '');
  if (!reply.length) {
    sendStatus('Réponse vide');
    return;
  }

  pendingChunks = splitReplyIntoChunks(reply);
  chunkIndex = 0;
  chunkRetries = 0;
  sendStatus('Transfert...');
  sendNextChunk();
}

function formatHttpError(responseText, status) {
  try {
    var data = JSON.parse(responseText);
    if (data.error && data.error.message) {
      return String(data.error.message).substring(0, 48);
    }
  } catch (err) {
    console.log('HTTP error body parse failed: ' + err);
  }
  return 'Erreur HTTP ' + status;
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
    console.log('Hermes HTTP ' + xhr.status + ' bytes=' + (xhr.responseText ? xhr.responseText.length : 0));

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        sendReplyChunks(extractReplyBody(xhr.responseText));
      } catch (err) {
        console.log('Invalid Hermes response: ' + err);
        var message = err && err.message ? String(err.message) : 'Réponse invalide';
        sendStatus(message.substring(0, 48));
      }
      return;
    }

    if (xhr.status === 401) {
      sendStatus('Clé API invalide');
      return;
    }

    sendStatus(formatHttpError(xhr.responseText, xhr.status));
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
