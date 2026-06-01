var Clay = require('pebble-clay');
var clayConfig = require('./config');
var customClay = require('./custom-clay');
var clay = new Clay(clayConfig, customClay, { autoHandleEvents: false });

var CHUNK_BYTES = 180;
var MAX_SINGLE_CHUNK_BYTES = 700;
var CHUNK_SEND_DELAY_MS = 120;
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
    MODEL: pickString(stored.MODEL),
    NO_THINK: isNoThinkEnabled(stored)
  };
}

function isNoThinkEnabled(source) {
  if (!source) {
    return true;
  }
  var v = source.NO_THINK;
  if (v === false || v === 0 || v === '0') {
    return false;
  }
  if (v === true || v === 1 || v === '1') {
    return true;
  }
  return true;
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

function utf8ByteLength(text) {
  return unescape(encodeURIComponent(String(text || ''))).length;
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

function buildChatPayload(prompt, request, config) {
  var body = {
    model: request.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false
  };

  if (isNoThinkEnabled(config)) {
    body.reasoning_effort = 'none';
    body.extra_body = { think: false };
  }

  return body;
}

function extractReplyBody(responseText, options) {
  options = options || {};
  if (!responseText) {
    throw new Error('Empty response');
  }

  if (responseText.indexOf('data:') === 0) {
    throw new Error('Streaming not supported');
  }

  var data = JSON.parse(responseText);

  if (data.error) {
    var errorMessage = data.error.message || data.error.code || 'Hermes error';
    throw new Error(errorMessage);
  }

  if (data.choices && data.choices.length > 0) {
    var choice = data.choices[0];
    if (choice.message) {
      var fromMessage = normalizeReplyContent(choice.message.content);
      if (fromMessage) {
        return fromMessage;
      }
      if (!options.skipReasoning) {
        if (typeof choice.message.refusal === 'string' && choice.message.refusal) {
          return choice.message.refusal;
        }
        if (typeof choice.message.reasoning_content === 'string' && choice.message.reasoning_content) {
          return choice.message.reasoning_content;
        }
      }
    }
    if (typeof choice.text === 'string' && choice.text) {
      return choice.text;
    }
    if (choice.delta && typeof choice.delta.content === 'string' && choice.delta.content) {
      return choice.delta.content;
    }
  }

  if (typeof data.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  if (typeof data.content === 'string' && data.content) {
    return data.content;
  }

  throw new Error('No text in response');
}

function sendStatus(message) {
  Pebble.sendAppMessage({ STATUS: message }, null, function (err) {
    console.log('Failed to send STATUS: ' + JSON.stringify(err));
  });
}

function prepareReplyChunks(text) {
  var reply = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!reply.length) {
    return [];
  }

  if (utf8ByteLength(reply) <= MAX_SINGLE_CHUNK_BYTES) {
    return [reply];
  }

  return splitReplyIntoChunks(reply);
}

function sendNextChunk() {
  if (chunkIndex >= pendingChunks.length) {
    Pebble.sendAppMessage({ REPLY_DONE: 1 }, function () {
      console.log('REPLY_DONE sent, bytes=' + utf8ByteLength(pendingChunks.join('')));
    }, function (err) {
      console.log('Failed to send REPLY_DONE: ' + JSON.stringify(err));
      sendStatus('Send failed');
    });
    return;
  }

  var part = chunkIndex + 1;
  var total = pendingChunks.length;
  sendStatus('Sending ' + part + '/' + total);

  Pebble.sendAppMessage({ REPLY_CHUNK: pendingChunks[chunkIndex] }, function () {
    chunkIndex += 1;
    chunkRetries = 0;
    setTimeout(sendNextChunk, CHUNK_SEND_DELAY_MS);
  }, function (err) {
    console.log('Failed to send REPLY_CHUNK ' + part + ': ' + JSON.stringify(err));
    if (chunkRetries < 3) {
      chunkRetries += 1;
      setTimeout(sendNextChunk, CHUNK_SEND_DELAY_MS);
      return;
    }
    sendStatus('Transfer failed');
  });
}

function sendReplyChunks(text) {
  pendingChunks = prepareReplyChunks(text);
  if (!pendingChunks.length) {
    sendStatus('Empty reply');
    return;
  }

  chunkIndex = 0;
  chunkRetries = 0;

  var totalBytes = utf8ByteLength(pendingChunks.join(''));
  console.log('Sending reply: ' + totalBytes + ' bytes, ' + pendingChunks.length + ' parts');

  Pebble.sendAppMessage({
    REPLY_PARTS: pendingChunks.length,
    REPLY_BYTES: totalBytes
  }, function () {
    sendStatus('Sending 0/' + pendingChunks.length);
    setTimeout(sendNextChunk, CHUNK_SEND_DELAY_MS);
  }, function (err) {
    console.log('Failed to send REPLY meta: ' + JSON.stringify(err));
    sendStatus('Send failed');
  });
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
  return 'HTTP ' + status;
}

function queryHermes(prompt, config) {
  var request = resolveHermesRequest(config);
  var xhr = new XMLHttpRequest();
  var waitStartedAt = Date.now();
  var heartbeatTimer = setInterval(function () {
    var elapsed = Math.floor((Date.now() - waitStartedAt) / 1000);
    sendStatus('Hermes… ' + elapsed + 's');
  }, 5000);

  function stopWaitTimer() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  var noThink = isNoThinkEnabled(config);
  sendStatus(noThink ? 'Hermes (fast)...' : 'Hermes thinking...');
  console.log(
    'Hermes POST ' + request.url +
    ' model=' + request.model +
    ' session=' + request.sessionKey +
    ' noThink=' + noThink +
    ' promptLen=' + (prompt ? prompt.length : 0)
  );

  xhr.open('POST', request.url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + request.key);
  xhr.setRequestHeader('X-Hermes-Session-Key', request.sessionKey);

  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      console.log('Hermes readyState=DONE status=' + xhr.status);
    }
  };

  xhr.onload = function () {
    stopWaitTimer();
    console.log('Hermes HTTP ' + xhr.status + ' bytes=' + (xhr.responseText ? xhr.responseText.length : 0));

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        var replyText = extractReplyBody(xhr.responseText, { skipReasoning: noThink }).trim();
        console.log('Hermes reply chars=' + replyText.length);
        sendReplyChunks(replyText);
      } catch (err) {
        console.log('Invalid Hermes response: ' + err);
        var message = err && err.message ? String(err.message) : 'Invalid response';
        sendStatus(message.substring(0, 48));
      }
      return;
    }

    if (xhr.status === 401) {
      sendStatus('Invalid API key');
      return;
    }

    sendStatus(formatHttpError(xhr.responseText, xhr.status));
  };

  xhr.timeout = CHAT_TIMEOUT_MS;

  xhr.ontimeout = function () {
    stopWaitTimer();
    sendStatus('Hermes timeout');
  };

  xhr.onerror = function () {
    stopWaitTimer();
    sendStatus('Hermes unreachable');
  };

  xhr.send(JSON.stringify(buildChatPayload(prompt, request, config)));
}

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload;
  if (!payload || !payload.PROMPT) {
    return;
  }

  var config = getConfig();
  if (!isConfigured(config)) {
    sendStatus('Open Settings');
    return;
  }

  queryHermes(payload.PROMPT, config);
});

Pebble.addEventListener('ready', function () {
  ensureConfigDefaults();
  console.log('Hermes for Pebble ready');
});
