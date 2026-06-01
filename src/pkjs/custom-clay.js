module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var CHAT_TEST_TIMEOUT_MS = 120000;
  var TEST_PROMPT = 'Réponds en une courte phrase : test Pebble OK.';
  var UI_FLUSH_MS = 80;
  var HEARTBEAT_MS = 2000;
  var MAX_LOG_LINES = 80;

  var modelTestInFlight = false;
  var apiTestInFlight = false;
  var terminalLines = [];
  var terminalPlainLines = [];
  var heartbeatTimer = null;
  var waitStartedAt = 0;

  var LEVEL_TAGS = {
    ok: 'OK',
    err: 'ERR',
    warn: 'WARN',
    http: 'HTTP',
    info: '--'
  };

  function pickString(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nowStamp() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    function pad(n) {
      return n < 10 ? '0' + n : String(n);
    }
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function maskSecret(value) {
    var s = pickString(value);
    if (!s) {
      return '(vide)';
    }
    if (s.length <= 6) {
      return '***';
    }
    return s.substring(0, 3) + '…' + s.substring(s.length - 2);
  }

  function terminalLog(level, message) {
    var stamp = nowStamp();
    var tag = LEVEL_TAGS[level] || LEVEL_TAGS.info;
    var prefix = '[' + stamp + '] ';
    if (level === 'ok') {
      prefix += '<span style="color:#6f6">OK</span> ';
    } else if (level === 'err') {
      prefix += '<span style="color:#f66">ERR</span> ';
    } else if (level === 'warn') {
      prefix += '<span style="color:#fc6">WARN</span> ';
    } else if (level === 'http') {
      prefix += '<span style="color:#6cf">HTTP</span> ';
    } else {
      prefix += '<span style="color:#aaa">--</span> ';
    }
    terminalLines.push(prefix + escapeHtml(message));
    terminalPlainLines.push('[' + stamp + '] ' + tag + ' ' + message);
    if (terminalLines.length > MAX_LOG_LINES) {
      terminalLines = terminalLines.slice(terminalLines.length - MAX_LOG_LINES);
      terminalPlainLines = terminalPlainLines.slice(terminalPlainLines.length - MAX_LOG_LINES);
    }
    renderTerminal();
  }

  function getTerminalPlainText() {
    if (!terminalPlainLines.length) {
      return '';
    }
    return terminalPlainLines.join('\n');
  }

  function copyTextWithFallback(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        onDone(true);
      }).catch(function() {
        copyTextWithExecCommand(text, onDone);
      });
      return;
    }
    copyTextWithExecCommand(text, onDone);
  }

  function copyTextWithExecCommand(text, onDone) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (err) {
      copied = false;
    }

    document.body.removeChild(textarea);
    onDone(copied);
  }

  function copyTerminalLogs() {
    var text = getTerminalPlainText();
    if (!text) {
      terminalLog('warn', 'Rien à copier — lancez un test d’abord');
      return;
    }

    copyTextWithFallback(text, function(success) {
      if (success) {
        terminalLog('ok', 'Logs copiés dans le presse-papiers (' + terminalPlainLines.length + ' lignes)');
      } else {
        terminalLog('err', 'Copie impossible — sélectionnez le journal manuellement');
      }
    });
  }

  function renderTerminal() {
    var statusItem = clayConfig.getItemById('api-test-status');
    if (!statusItem) {
      return;
    }
    var body = terminalLines.length
      ? terminalLines.join('\n')
      : '<span style="color:#888">Journal vide — lancez un test.</span>';
    statusItem.set(
      '<div style="font-family:monospace;font-size:11px;line-height:1.45;' +
      'background:#111;color:#ddd;padding:10px;border-radius:6px;' +
      'border:1px solid #333;max-height:280px;overflow-y:auto;' +
      'white-space:pre-wrap;word-break:break-word;">' +
      body +
      '</div>'
    );
  }

  function clearTerminal(title) {
    terminalLines = [];
    terminalPlainLines = [];
    if (title) {
      terminalLog('info', title);
    }
    renderTerminal();
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    waitStartedAt = 0;
  }

  function startHeartbeat(label) {
    stopHeartbeat();
    waitStartedAt = Date.now();
    heartbeatTimer = setInterval(function() {
      var elapsed = Math.floor((Date.now() - waitStartedAt) / 1000);
      terminalLog('info', label + '… ' + elapsed + ' s');
    }, HEARTBEAT_MS);
  }

  function flushUi(next) {
    setTimeout(function() {
      renderTerminal();
      setTimeout(next, UI_FLUSH_MS);
    }, 0);
  }

  function getStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem('clay-settings')) || {};
    } catch (err) {
      return {};
    }
  }

  function getFieldValue(messageKey) {
    var item = clayConfig.getItemByMessageKey(messageKey);
    var value = pickString(item ? item.get() : '');
    if (value) {
      return value;
    }
    return pickString(getStoredSettings()[messageKey]);
  }

  function snapshotFormToStorage() {
    var stored = getStoredSettings();
    var server = getFieldValue('HERMES_SERVER');
    var key = getFieldValue('HERMES_KEY');
    var model = getFieldValue('MODEL');
    var session = getFieldValue('SESSION_KEY');

    if (server) {
      stored.HERMES_SERVER = server;
    }
    if (key) {
      stored.HERMES_KEY = key;
    }
    if (model) {
      stored.MODEL = model;
    }
    if (session) {
      stored.SESSION_KEY = session;
    }

    localStorage.setItem('clay-settings', JSON.stringify(stored));
  }

  function getServerUrl() {
    var server = getFieldValue('HERMES_SERVER');
    if (!server) {
      server = pickString(getStoredSettings().PAIRING_SERVER);
    }

    server = server.replace(/\/+$/, '');
    if (!server) {
      return '';
    }
    if (server.indexOf('://') === -1) {
      server = 'http://' + server;
    }
    return server.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  }

  function getApiKey() {
    var key = getFieldValue('HERMES_KEY');
    if (key) {
      return key;
    }
    return pickString(getStoredSettings().PAIRING_KEY);
  }

  function getSessionKey() {
    var session = getFieldValue('SESSION_KEY');
    if (session) {
      return session;
    }
    return 'pebble:default';
  }

  function xhrStateLabel(readyState) {
    switch (readyState) {
      case 0: return 'UNSENT';
      case 1: return 'OPENED';
      case 2: return 'HEADERS_RECEIVED';
      case 3: return 'LOADING';
      case 4: return 'DONE';
      default: return String(readyState);
    }
  }

  function attachXhrTrace(xhr, label) {
    var lastState = -1;
    xhr.onreadystatechange = function() {
      if (xhr.readyState === lastState) {
        return;
      }
      lastState = xhr.readyState;
      var extra = '';
      if (xhr.readyState === 4) {
        extra = ' status=' + xhr.status;
      }
      terminalLog('http', label + ' readyState=' + xhrStateLabel(xhr.readyState) + extra);
    };
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
        } else if (part && typeof part === 'object' && typeof part.text === 'string' && part.text) {
          parts.push(part.text);
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
      throw new Error(data.error.message || data.error.code || 'Erreur Hermes');
    }
    if (data.choices && data.choices.length > 0) {
      if (data.choices[0].message) {
        return normalizeReplyContent(data.choices[0].message.content);
      }
      if (typeof data.choices[0].text === 'string') {
        return data.choices[0].text;
      }
    }
    if (typeof data.output_text === 'string') {
      return data.output_text;
    }
    throw new Error('Pas de texte dans la réponse');
  }

  function applyFirstModelFromResponse(responseText) {
    try {
      var data = JSON.parse(responseText);
      if (!data.data || !data.data.length || !data.data[0].id) {
        return null;
      }

      var modelId = pickString(data.data[0].id);
      var modelItem = clayConfig.getItemByMessageKey('MODEL');
      if (modelItem) {
        modelItem.set(modelId);
      }

      var stored = getStoredSettings();
      stored.MODEL = modelId;
      localStorage.setItem('clay-settings', JSON.stringify(stored));
      return modelId;
    } catch (err) {
      return null;
    }
  }

  function formatModelsMessage(responseText, appliedModelId) {
    try {
      var data = JSON.parse(responseText);
      if (!data.data || !data.data.length) {
        return 'Serveur joignable';
      }

      var names = [];
      for (var i = 0; i < data.data.length; i += 1) {
        if (data.data[i].id) {
          names.push(data.data[i].id);
        }
      }

      if (!names.length) {
        return 'Serveur joignable';
      }

      if (appliedModelId) {
        return 'Modèle « ' + appliedModelId + ' » sélectionné';
      }

      return 'Modèles : ' + names.join(', ');
    } catch (err) {
      return 'Serveur joignable';
    }
  }

  function testApiConnection() {
    if (apiTestInFlight) {
      terminalLog('warn', 'Test connexion déjà en cours');
      return;
    }

    var baseUrl = getServerUrl();
    var apiKey = getApiKey();

    clearTerminal('=== Test connexion ===');
    terminalLog('info', 'Serveur : ' + (baseUrl || '(manquant)'));
    terminalLog('info', 'Clé API : ' + maskSecret(apiKey));

    if (!baseUrl) {
      terminalLog('err', 'Serveur requis');
      return;
    }

    apiTestInFlight = true;

    function finish(success, message) {
      apiTestInFlight = false;
      stopHeartbeat();
      if (success) {
        terminalLog('ok', message);
      } else {
        terminalLog('err', message);
      }
    }

    function tryModels() {
      var url = baseUrl + '/v1/models';
      terminalLog('http', 'GET ' + url);
      startHeartbeat('Attente /v1/models');

      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = HTTP_TIMEOUT_MS;
      attachXhrTrace(xhr, 'models');
      if (apiKey) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
      }

      xhr.onload = function() {
        stopHeartbeat();
        terminalLog('http', 'GET /v1/models → HTTP ' + xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          var appliedModelId = applyFirstModelFromResponse(xhr.responseText);
          finish(true, formatModelsMessage(xhr.responseText, appliedModelId));
          return;
        }
        if (xhr.status === 401) {
          finish(false, 'Clé API invalide');
          return;
        }
        finish(false, 'Erreur HTTP ' + xhr.status);
      };

      xhr.onerror = function() {
        stopHeartbeat();
        finish(false, 'Réseau : GET /v1/models échoué');
      };

      xhr.ontimeout = function() {
        stopHeartbeat();
        finish(false, 'Timeout GET /v1/models');
      };

      terminalLog('info', 'xhr.send()…');
      xhr.send();
    }

    function tryHealth() {
      var url = baseUrl + '/health';
      terminalLog('http', 'GET ' + url);
      startHeartbeat('Attente /health');

      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = HTTP_TIMEOUT_MS;
      attachXhrTrace(xhr, 'health');

      xhr.onload = function() {
        stopHeartbeat();
        terminalLog('http', 'GET /health → HTTP ' + xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (apiKey) {
            tryModels();
            return;
          }
          finish(true, 'Serveur joignable (sans test clé)');
          return;
        }
        if (apiKey) {
          terminalLog('warn', '/health HTTP ' + xhr.status + ' — essai /v1/models');
          tryModels();
          return;
        }
        finish(false, 'Erreur HTTP ' + xhr.status + ' sur /health');
      };

      xhr.onerror = function() {
        stopHeartbeat();
        if (apiKey) {
          terminalLog('warn', '/health injoignable — essai /v1/models');
          tryModels();
          return;
        }
        finish(false, 'Réseau : GET /health échoué');
      };

      xhr.ontimeout = function() {
        stopHeartbeat();
        finish(false, 'Timeout GET /health');
      };

      terminalLog('info', 'xhr.send()…');
      xhr.send();
    }

    flushUi(tryHealth);
  }

  function testModelPrompt() {
    if (modelTestInFlight) {
      terminalLog('warn', 'Test prompt déjà en cours');
      return;
    }

    var baseUrl = getServerUrl();
    var apiKey = getApiKey();
    var model = getFieldValue('MODEL') || 'hermes';
    var sessionKey = getSessionKey();
    var postUrl = baseUrl + '/v1/chat/completions';
    var body = {
      model: model,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      stream: false
    };

    clearTerminal('=== Test prompt ===');
    terminalLog('info', 'Clic bouton enregistré');
    terminalLog('info', 'URL POST : ' + (postUrl || '(manquant)'));
    terminalLog('info', 'Modèle : ' + model);
    terminalLog('info', 'Clé API : ' + maskSecret(apiKey));
    terminalLog('info', 'Session : ' + escapeHtml(sessionKey) + ' (non envoyée ici, comme test web)');
    terminalLog('info', 'Prompt : ' + TEST_PROMPT);

    if (!baseUrl) {
      terminalLog('err', 'Serveur requis');
      return;
    }
    if (!apiKey) {
      terminalLog('err', 'Clé API requise');
      return;
    }

    snapshotFormToStorage();
    modelTestInFlight = true;

    function finish(success, message) {
      modelTestInFlight = false;
      stopHeartbeat();
      if (success) {
        terminalLog('ok', message);
      } else {
        terminalLog('err', message);
      }
    }

    function runPost() {
      terminalLog('info', 'Préparation XMLHttpRequest…');
      terminalLog('http', 'POST ' + postUrl);
      terminalLog('info', 'Corps JSON : model=' + model + ', stream=false');
      startHeartbeat('Attente réponse Hermes');

      var xhr = new XMLHttpRequest();
      try {
        xhr.open('POST', postUrl, true);
      } catch (openErr) {
        stopHeartbeat();
        finish(false, 'xhr.open : ' + (openErr.message || openErr));
        return;
      }

      xhr.timeout = CHAT_TEST_TIMEOUT_MS;
      attachXhrTrace(xhr, 'chat');

      try {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
        terminalLog('info', 'En-têtes : Content-Type, Authorization');
      } catch (headerErr) {
        stopHeartbeat();
        finish(false, 'En-têtes refusés : ' + (headerErr.message || headerErr));
        return;
      }

      xhr.onload = function() {
        stopHeartbeat();
        var bytes = xhr.responseText ? xhr.responseText.length : 0;
        terminalLog('http', 'POST terminé → HTTP ' + xhr.status + ' (' + bytes + ' octets)');

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var reply = extractReplyBody(xhr.responseText);
            if (!reply) {
              finish(false, 'Réponse HTTP OK mais texte vide');
              return;
            }
            var preview = reply.replace(/\s+/g, ' ').substring(0, 200);
            finish(true, 'Réponse : ' + preview + (reply.length > 200 ? '…' : ''));
          } catch (err) {
            finish(false, err.message || 'Réponse invalide');
          }
          return;
        }

        if (xhr.status === 401) {
          finish(false, 'Clé API invalide (401)');
          return;
        }

        try {
          var errData = JSON.parse(xhr.responseText);
          if (errData.error && errData.error.message) {
            finish(false, String(errData.error.message).substring(0, 160));
            return;
          }
        } catch (parseErr) {
          terminalLog('warn', 'Corps erreur non-JSON');
        }

        finish(false, 'Erreur HTTP ' + xhr.status);
      };

      xhr.onerror = function() {
        stopHeartbeat();
        finish(false, 'Réseau/CORS : POST bloqué ou serveur injoignable');
      };

      xhr.ontimeout = function() {
        stopHeartbeat();
        finish(false, 'Timeout (>2 min) sans réponse');
      };

      var payload;
      try {
        payload = JSON.stringify(body);
        terminalLog('info', 'Payload : ' + payload.length + ' octets');
      } catch (jsonErr) {
        stopHeartbeat();
        finish(false, 'JSON : ' + (jsonErr.message || jsonErr));
        return;
      }

      flushUi(function() {
        terminalLog('info', 'Appel xhr.send() maintenant…');
        try {
          xhr.send(payload);
          terminalLog('info', 'xhr.send() retourné (requête partie)');
        } catch (sendErr) {
          stopHeartbeat();
          finish(false, 'xhr.send : ' + (sendErr.message || sendErr));
        }
      });
    }

    flushUi(runPost);
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    renderTerminal();

    var testBtn = clayConfig.getItemById('api-test');
    if (testBtn) {
      testBtn.on('click', testApiConnection);
    }

    var modelBtn = clayConfig.getItemById('model-test');
    if (modelBtn) {
      modelBtn.on('click', testModelPrompt);
    }

    var copyBtn = clayConfig.getItemById('copy-logs');
    if (copyBtn) {
      copyBtn.on('click', copyTerminalLogs);
    }
  });
};
