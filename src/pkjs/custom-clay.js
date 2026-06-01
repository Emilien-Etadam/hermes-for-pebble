module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var UI_FLUSH_MS = 80;
  var HEARTBEAT_MS = 2000;
  var MAX_LOG_LINES = 50;
  var TERMINAL_STYLE =
    'font-family:monospace;font-size:10px;line-height:1.3;' +
    'background:#111;color:#bbb;padding:6px;border-radius:4px;' +
    'border:1px solid #333;max-height:160px;overflow-y:auto;' +
    'white-space:pre-wrap;word-break:break-word;';

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
      return '(empty)';
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
      terminalLog('warn', 'Nothing to copy — run Test connection first');
      return;
    }

    copyTextWithFallback(text, function(success) {
      if (success) {
        terminalLog('ok', 'Log copied (' + terminalPlainLines.length + ' lines)');
      } else {
        terminalLog('err', 'Copy failed — select the log manually');
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
      : '<span style="color:#888">No log yet — tap Test connection.</span>';
    statusItem.set('<div style="' + TERMINAL_STYLE + '">' + body + '</div>');
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
    var vibrateItem = clayConfig.getItemByMessageKey('VIBRATE_ON');

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
    if (vibrateItem) {
      stored.VIBRATE_ON = vibrateItem.get();
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
        return 'Server reachable';
      }

      var names = [];
      for (var i = 0; i < data.data.length; i += 1) {
        if (data.data[i].id) {
          names.push(data.data[i].id);
        }
      }

      if (!names.length) {
        return 'Server reachable';
      }

      if (appliedModelId) {
        return 'Model set to ' + appliedModelId;
      }

      return 'Models: ' + names.join(', ');
    } catch (err) {
      return 'Server reachable';
    }
  }

  function testApiConnection() {
    if (apiTestInFlight) {
      terminalLog('warn', 'Connection test already running');
      return;
    }

    var baseUrl = getServerUrl();
    var apiKey = getApiKey();

    clearTerminal('=== Connection test ===');
    terminalLog('info', 'Server: ' + (baseUrl || '(missing)'));
    terminalLog('info', 'API key: ' + maskSecret(apiKey));

    if (!baseUrl) {
      terminalLog('err', 'Server URL required');
      return;
    }

    apiTestInFlight = true;

    function finish(success, message) {
      apiTestInFlight = false;
      stopHeartbeat();
      if (success) {
        snapshotFormToStorage();
        terminalLog('ok', message);
        terminalLog('info', 'Tap Save, then SELECT on the watch to chat');
      } else {
        terminalLog('err', message);
      }
    }

    function tryModels() {
      var url = baseUrl + '/v1/models';
      terminalLog('http', 'GET ' + url);
      startHeartbeat('Waiting /v1/models');

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
          finish(false, 'Invalid API key');
          return;
        }
        finish(false, 'HTTP ' + xhr.status);
      };

      xhr.onerror = function() {
        stopHeartbeat();
        finish(false, 'Network error (GET /v1/models)');
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
      startHeartbeat('Waiting /health');

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
          finish(true, 'Server reachable (key not tested)');
          return;
        }
        if (apiKey) {
          terminalLog('warn', '/health HTTP ' + xhr.status + ' — trying /v1/models');
          tryModels();
          return;
        }
        finish(false, 'HTTP ' + xhr.status + ' on /health');
      };

      xhr.onerror = function() {
        stopHeartbeat();
        if (apiKey) {
          terminalLog('warn', '/health unreachable — trying /v1/models');
          tryModels();
          return;
        }
        finish(false, 'Network error (GET /health)');
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
