var Clay = require('pebble-clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var DEFAULT_HERMES_URL = '';
var DEFAULT_HERMES_KEY = '';
var DEFAULT_SESSION_KEY = 'pebble:emilien';
var DEFAULT_MODEL = 'hermes';

var CHUNK_MAX_BYTES = 900;

var pendingChunks = [];
var chunkIndex = 0;

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

function utf8CharByteLength(code, nextCode) {
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  if (code >= 0xD800 && code < 0xDC00) {
    if (nextCode >= 0xDC00 && nextCode < 0xE000) {
      return 4;
    }
    return 3;
  }
  return 3;
}

function sliceUtf8ByMaxBytes(text, start, maxBytes) {
  var byteCount = 0;
  var index = start;

  while (index < text.length) {
    var code = text.charCodeAt(index);
    var nextCode = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    var charBytes = utf8CharByteLength(code, nextCode);

    if (byteCount + charBytes > maxBytes) {
      break;
    }

    byteCount += charBytes;
    index += (code >= 0xD800 && code < 0xDC00 && nextCode >= 0xDC00 && nextCode < 0xE000) ? 2 : 1;
  }

  return text.slice(start, index);
}

function buildReplyChunks(text) {
  var chunks = [];
  var offset = 0;

  while (offset < text.length) {
    var chunk = sliceUtf8ByMaxBytes(text, offset, CHUNK_MAX_BYTES);
    if (!chunk.length) {
      break;
    }
    chunks.push(chunk);
    offset += chunk.length;
  }

  if (!chunks.length) {
    chunks.push('');
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
    sendNextChunk();
  }, function (err) {
    console.log('Failed to send REPLY_CHUNK: ' + JSON.stringify(err));
    sendStatus('Erreur envoi réponse');
  });
}

function sendReplyChunks(text) {
  pendingChunks = buildReplyChunks(text);
  chunkIndex = 0;
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

  xhr.onerror = function () {
    sendStatus('Réseau indisponible');
  };

  xhr.send(JSON.stringify({
    model: config.MODEL,
    messages: [{ role: 'user', content: prompt }]
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
});
