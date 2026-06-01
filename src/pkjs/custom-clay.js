module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var CHAT_TEST_TIMEOUT_MS = 120000;
  var TEST_PROMPT = 'Réponds en une courte phrase : test Pebble OK.';
  var modelTestInFlight = false;
  var apiTestInFlight = false;

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
        return 'Serveur OK · modèle « ' + appliedModelId + ' » sélectionné';
      }

      return 'Serveur joignable · modèles : ' + names.join(', ');
    } catch (err) {
      return 'Serveur joignable';
    }
  }

  function testApiConnection() {
    if (apiTestInFlight) {
      return;
    }

    setApiTestStatus('Test connectivité…');

    var baseUrl = getServerUrl();
    var apiKey = getApiKey();

    if (!baseUrl) {
      setApiTestStatus('<span style="color:#c00">Serveur requis</span>');
      return;
    }

    apiTestInFlight = true;

    function finish(success, message) {
      apiTestInFlight = false;
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
    if (modelTestInFlight) {
      return;
    }

    setApiTestStatus('Envoi du prompt…');

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
    modelTestInFlight = true;
    setApiTestStatus('Hermes réfléchit (modèle « ' + escapeHtml(model) + ' »)…');

    function finish(success, message) {
      modelTestInFlight = false;
      var color = success ? '#080' : '#c00';
      setApiTestStatus('<span style="color:' + color + '">' + message + '</span>');
    }

    function sendPromptRequest() {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', baseUrl + '/v1/chat/completions', true);
      xhr.timeout = CHAT_TEST_TIMEOUT_MS;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var reply = extractReplyBody(xhr.responseText);
            if (!reply) {
              finish(false, 'Modèle OK mais réponse vide');
              return;
            }
            var preview = reply.replace(/\s+/g, ' ').substring(0, 160);
            finish(
              true,
              'Modèle OK · ' + escapeHtml(preview) + (reply.length > 160 ? '…' : '')
            );
          } catch (err) {
            finish(false, escapeHtml(err.message || 'Réponse invalide'));
          }
          return;
        }

        if (xhr.status === 401) {
          finish(false, 'Clé API invalide');
          return;
        }

        try {
          var errData = JSON.parse(xhr.responseText);
          if (errData.error && errData.error.message) {
            finish(false, escapeHtml(String(errData.error.message).substring(0, 120)));
            return;
          }
        } catch (parseErr) {
          console.log('Model test error parse failed: ' + parseErr);
        }

        finish(false, 'Erreur HTTP ' + xhr.status);
      };

      xhr.onerror = function() {
        finish(false, 'POST bloqué (réseau/CORS)');
      };

      xhr.ontimeout = function() {
        finish(false, 'Timeout (&gt;2 min)');
      };

      xhr.send(JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        stream: false
      }));
    }

    setTimeout(sendPromptRequest, 0);
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
