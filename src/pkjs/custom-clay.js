module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var UI_FLUSH_MS = 80;
  var HEARTBEAT_MS = 2000;
  var MAX_LOG_LINES = 80;

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
      : '<span style="color:#888">Journal vide — testez la connexion.</span>';
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
    var noThinkItem = clayConfig.getItemByMessageKey('NO_THINK');

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
    if (noThinkItem) {
      stored.NO_THINK = noThinkItem.get();
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
        snapshotFormToStorage();
        terminalLog('ok', message);
        terminalLog('info', 'Appuyez sur Enregistrer, puis SELECT sur la montre pour parler à Hermes');
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

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    renderTerminal();

    var testBtn = clayConfig.getItemById('api-test');
    if (testBtn) {
      testBtn.on('click', testApiConnection);
    }

    var copyBtn = clayConfig.getItemById('copy-logs');
    if (copyBtn) {
      copyBtn.on('click', copyTerminalLogs);
    }
  });
};
