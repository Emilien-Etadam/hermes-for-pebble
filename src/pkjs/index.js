var Clay = require('pebble-clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var DEFAULT_HERMES_URL = 'http://192.168.30.140:8642/v1/chat/completions';
var DEFAULT_HERMES_KEY = '698e3bbc841346e098bc46b69d43f7b7';
var DEFAULT_SESSION_KEY = 'pebble:emilien';
var DEFAULT_MODEL = 'hermes';

var CHUNK_BYTES = 200;
var HTTP_TIMEOUT_MS = 60000;

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
});

function pickString(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  var text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function getConfig() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (err) {
    stored = {};
  }

  return {
    HERMES_URL: pickString(stored.HERMES_URL, DEFAULT_HERMES_URL),
    HERMES_KEY: pickString(stored.HERMES_KEY, DEFAULT_HERMES_KEY),
    SESSION_KEY: pickString(stored.SESSION_KEY, DEFAULT_SESSION_KEY),
    MODEL: pickString(stored.MODEL, DEFAULT_MODEL)
  };
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
  var xhr = new XMLHttpRequest();
  xhr.open('POST', config.HERMES_URL, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + config.HERMES_KEY);
  xhr.setRequestHeader('X-Hermes-Session-Key', config.SESSION_KEY);

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

    sendStatus('Erreur HTTP ' + xhr.status);
  };

  xhr.timeout = HTTP_TIMEOUT_MS;

  xhr.ontimeout = function () {
    sendStatus('Hermes injoignable');
  };

  xhr.onerror = function () {
    sendStatus('Hermes injoignable');
  };

  xhr.send(JSON.stringify({
    model: config.MODEL,
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
  if (!config.HERMES_URL || !config.HERMES_KEY) {
    sendStatus('Config manquante');
    return;
  }

  queryHermes(payload.PROMPT, config);
});

Pebble.addEventListener('ready', function () {
  console.log('Hermes for Pebble ready');

  // Auto-apply preset config (one-click setup from phone browser)
  try {
    var preset = JSON.parse(localStorage.getItem('__hermes_pebble_preset__') || 'null');
    if (preset && preset.HERMES_URL && preset.HERMES_KEY) {
      localStorage.setItem('clay-settings', JSON.stringify({
        HERMES_URL: preset.HERMES_URL,
        HERMES_KEY: preset.HERMES_KEY,
        SESSION_KEY: preset.SESSION_KEY || 'pebble:emilien',
        MODEL: preset.MODEL || 'hermes'
      }));
      localStorage.removeItem('__hermes_pebble_preset__');
      console.log('Preset config applied');
    }
  } catch (e) { /* ignore */ }
});
