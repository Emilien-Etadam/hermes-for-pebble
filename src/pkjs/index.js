var Clay = require('pebble-clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

var CHUNK_BYTES = 200;
var HTTP_TIMEOUT_MS = 60000;
var PAIR_POLL_INTERVAL_MS = 2000;
var PAIR_TIMEOUT_MS = 60000;

var pendingChunks = [];
var chunkIndex = 0;
var chunkRetries = 0;

var pairingActive = false;
var pairingCode = null;
var pairingPollTimer = null;
var pairingTimeoutTimer = null;
var pairingPollInFlight = false;

var LEGACY_PRESET_URL = 'http://192.168.30.140:8642/v1/chat/completions';
var LEGACY_PRESET_KEY = '698e3bbc841346e098bc46b69d43f7b7';
var LEGACY_PRESET_SESSION = 'pebble:emilien';

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) {
    return;
  }
  clay.getSettings(e.response);
});

function pickString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function clearLegacyPresetIfPresent() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (err) {
    return;
  }

  if (stored.HERMES_URL === LEGACY_PRESET_URL &&
      stored.HERMES_KEY === LEGACY_PRESET_KEY &&
      stored.SESSION_KEY === LEGACY_PRESET_SESSION) {
    delete stored.HERMES_URL;
    delete stored.HERMES_KEY;
    delete stored.SESSION_KEY;
    delete stored.MODEL;
    localStorage.setItem('clay-settings', JSON.stringify(stored));
  }
}

function getConfig() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (err) {
    stored = {};
  }

  return {
    HERMES_URL: pickString(stored.HERMES_URL),
    HERMES_KEY: pickString(stored.HERMES_KEY),
    SESSION_KEY: pickString(stored.SESSION_KEY),
    MODEL: pickString(stored.MODEL),
    PAIRING_SERVER: pickString(stored.PAIRING_SERVER)
  };
}

function isConfigured(config) {
  return config.HERMES_URL.length > 0 && config.HERMES_KEY.length > 0;
}

function getHermesUrlBase(url) {
  if (!url) {
    return '';
  }
  var base = String(url).replace(/\/v1\/chat\/completions\/?$/, '');
  return base.replace(/\/+$/, '');
}

function getPairingServerUrl(config) {
  if (config.PAIRING_SERVER) {
    var server = config.PAIRING_SERVER.replace(/\/+$/, '');
    if (server.indexOf('://') === -1) {
      server = 'http://' + server;
    }
    return server;
  }
  return getHermesUrlBase(config.HERMES_URL);
}

function generatePairCode() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var code = '';
  for (var i = 0; i < 4; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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

function sendPairCode(code) {
  Pebble.sendAppMessage({ PAIR_CODE: code }, null, function (err) {
    console.log('Failed to send PAIR_CODE: ' + JSON.stringify(err));
    sendStatus('Erreur envoi code');
  });
}

function savePairedConfig(config) {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
  } catch (err) {
    stored = {};
  }

  if (config.url) {
    stored.HERMES_URL = config.url;
  }
  if (config.key) {
    stored.HERMES_KEY = config.key;
  }
  if (config.session_key) {
    stored.SESSION_KEY = config.session_key;
  }
  if (config.model) {
    stored.MODEL = config.model;
  }

  localStorage.setItem('clay-settings', JSON.stringify(stored));
}

function stopPairingPoll() {
  pairingActive = false;
  pairingCode = null;
  pairingPollInFlight = false;

  if (pairingPollTimer !== null) {
    clearInterval(pairingPollTimer);
    pairingPollTimer = null;
  }

  if (pairingTimeoutTimer !== null) {
    clearTimeout(pairingTimeoutTimer);
    pairingTimeoutTimer = null;
  }
}

function pollPairingConfig() {
  if (!pairingActive || !pairingCode || pairingPollInFlight) {
    return;
  }

  var config = getConfig();
  var baseUrl = getPairingServerUrl(config);
  var pollUrl = baseUrl + '/pair/poll?code=' + encodeURIComponent(pairingCode);

  pairingPollInFlight = true;

  var xhr = new XMLHttpRequest();
  xhr.open('GET', pollUrl, true);

  xhr.onload = function () {
    pairingPollInFlight = false;

    if (!pairingActive) {
      return;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.ok && data.config) {
          stopPairingPoll();
          savePairedConfig(data.config);
          sendStatus('Connecté...');
          sendStatus('Appairage réussi');
          return;
        }
      } catch (err) {
        console.log('Invalid pairing poll response: ' + err);
      }
    }

    if (xhr.status >= 400) {
      console.log('Pairing poll HTTP ' + xhr.status);
    }
  };

  xhr.onerror = function () {
    pairingPollInFlight = false;
    console.log('Pairing poll network error');
  };

  xhr.ontimeout = function () {
    pairingPollInFlight = false;
    console.log('Pairing poll timeout');
  };

  xhr.timeout = HTTP_TIMEOUT_MS;
  xhr.send();
}

function startPairing() {
  stopPairingPoll();

  var config = getConfig();
  var baseUrl = getPairingServerUrl(config);
  if (!baseUrl) {
    sendStatus('Serveur requis (Settings)');
    return;
  }

  pairingActive = true;
  pairingCode = generatePairCode();
  sendPairCode(pairingCode);

  pairingPollTimer = setInterval(pollPairingConfig, PAIR_POLL_INTERVAL_MS);
  pollPairingConfig();

  pairingTimeoutTimer = setTimeout(function () {
    if (!pairingActive) {
      return;
    }
    stopPairingPoll();
    sendStatus('Expiration');
  }, PAIR_TIMEOUT_MS);
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
  if (!payload) {
    return;
  }

  if (payload.PAIRING_START) {
    startPairing();
    return;
  }

  if (payload.PAIRING_STOP) {
    stopPairingPoll();
    return;
  }

  if (!payload.PROMPT) {
    return;
  }

  var config = getConfig();
  if (!isConfigured(config)) {
    sendStatus('Non configuré · UP appairer');
    return;
  }

  queryHermes(payload.PROMPT, config);
});

Pebble.addEventListener('ready', function () {
  clearLegacyPresetIfPresent();
  console.log('Hermes for Pebble ready');
});
