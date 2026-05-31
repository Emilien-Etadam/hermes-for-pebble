module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var MODEL_TEST_KEY = 'hermes-model-test';
  var MODEL_TEST_POLL_MS = 500;
  var MODEL_TEST_WAIT_MS = 130000;

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

  function setApiTestStatus(text) {
    var statusItem = clayConfig.getItemById('api-test-status');
    if (statusItem) {
      statusItem.set(text);
    }
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
        return 'Serveur OK · modèle « ' + appliedModelId + ' » sélectionné';
      }

      return 'Serveur joignable · modèles : ' + names.join(', ');
    } catch (err) {
      return 'Serveur joignable';
    }
  }

  function setButtonDisabled(id, disabled) {
    var btn = clayConfig.getItemById(id);
    if (btn) {
      if (disabled) {
        btn.disable();
      } else {
        btn.enable();
      }
    }
  }

  function readModelTestState() {
    try {
      return JSON.parse(localStorage.getItem(MODEL_TEST_KEY));
    } catch (err) {
      return null;
    }
  }

  function testApiConnection() {
    var baseUrl = getServerUrl();
    var apiKey = getApiKey();

    if (!baseUrl) {
      setApiTestStatus('<span style="color:#c00">Serveur requis</span>');
      return;
    }

    setApiTestStatus('Test connectivité…');
    setButtonDisabled('api-test', true);
    setButtonDisabled('model-test', true);

    function finish(success, message) {
      setButtonDisabled('api-test', false);
      setButtonDisabled('model-test', false);
      var color = success ? '#080' : '#c00';
      setApiTestStatus('<span style="color:' + color + '">' + escapeHtml(message) + '</span>');
    }

    function tryModels() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', baseUrl + '/v1/models', true);
      xhr.timeout = HTTP_TIMEOUT_MS;
      if (apiKey) {
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
      }

      xhr.onload = function() {
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
        finish(false, 'Serveur injoignable');
      };

      xhr.ontimeout = function() {
        finish(false, 'Délai dépassé');
      };

      xhr.send();
    }

    function tryHealth() {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', baseUrl + '/health', true);
      xhr.timeout = HTTP_TIMEOUT_MS;

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (apiKey) {
            tryModels();
            return;
          }
          finish(true, 'Serveur joignable (sans test clé/modèle)');
          return;
        }
        if (apiKey) {
          tryModels();
          return;
        }
        finish(false, 'Erreur HTTP ' + xhr.status);
      };

      xhr.onerror = function() {
        if (apiKey) {
          tryModels();
          return;
        }
        finish(false, 'Serveur injoignable');
      };

      xhr.ontimeout = function() {
        finish(false, 'Délai dépassé');
      };

      xhr.send();
    }

    tryHealth();
  }

  function testModelPrompt() {
    var baseUrl = getServerUrl();
    var apiKey = getApiKey();
    var model = getFieldValue('MODEL') || 'hermes';

    if (!baseUrl) {
      setApiTestStatus('<span style="color:#c00">Serveur requis</span>');
      return;
    }
    if (!apiKey) {
      setApiTestStatus('<span style="color:#c00">Clé API requise</span>');
      return;
    }

    snapshotFormToStorage();

    localStorage.setItem(MODEL_TEST_KEY, JSON.stringify({
      status: 'pending',
      requestedAt: Date.now()
    }));

    setApiTestStatus('Test chat via l’app (modèle « ' + escapeHtml(model) + ' »)…');
    setButtonDisabled('api-test', true);
    setButtonDisabled('model-test', true);

    function finish(success, message) {
      setButtonDisabled('api-test', false);
      setButtonDisabled('model-test', false);
      var color = success ? '#080' : '#c00';
      setApiTestStatus('<span style="color:' + color + '">' + message + '</span>');
    }

    var startedAt = Date.now();
    var pollTimer = setInterval(function() {
      var state = readModelTestState();

      if (state && state.status === 'done') {
        clearInterval(pollTimer);
        finish(state.success, escapeHtml(state.message || 'Terminé'));
        return;
      }

      if (Date.now() - startedAt > MODEL_TEST_WAIT_MS) {
        clearInterval(pollTimer);
        finish(false, 'Timeout attente réponse');
      }
    }, MODEL_TEST_POLL_MS);
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var testBtn = clayConfig.getItemById('api-test');
    if (testBtn) {
      testBtn.on('click', testApiConnection);
    }

    var modelBtn = clayConfig.getItemById('model-test');
    if (modelBtn) {
      modelBtn.on('click', testModelPrompt);
    }
  });
};
