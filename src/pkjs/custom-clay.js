module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;

  function pickString(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  function getStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem('clay-settings')) || {};
    } catch (err) {
      return {};
    }
  }

  function getServerUrl() {
    var serverItem = clayConfig.getItemByMessageKey('HERMES_SERVER');
    var server = pickString(serverItem ? serverItem.get() : '');
    var stored = getStoredSettings();

    if (!server) {
      server = pickString(stored.HERMES_SERVER);
    }
    if (!server) {
      server = pickString(stored.PAIRING_SERVER);
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
    var keyItem = clayConfig.getItemByMessageKey('HERMES_KEY');
    var key = pickString(keyItem ? keyItem.get() : '');
    var stored = getStoredSettings();

    if (key) {
      return key;
    }
    return pickString(stored.HERMES_KEY) || pickString(stored.PAIRING_KEY);
  }

  function setApiTestStatus(text) {
    var statusItem = clayConfig.getItemById('api-test-status');
    if (statusItem) {
      statusItem.set(text);
    }
  }

  function testApiConnection() {
    var baseUrl = getServerUrl();
    var apiKey = getApiKey();
    var testBtn = clayConfig.getItemById('api-test');

    if (!baseUrl) {
      setApiTestStatus('<span style="color:#c00">Serveur requis</span>');
      return;
    }

    setApiTestStatus('Test en cours…');
    if (testBtn) {
      testBtn.disable();
    }

    function finish(success, message) {
      if (testBtn) {
        testBtn.enable();
      }
      var color = success ? '#080' : '#c00';
      setApiTestStatus('<span style="color:' + color + '">' + message + '</span>');
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
          finish(true, 'API accessible');
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
          finish(true, 'API accessible');
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

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var testBtn = clayConfig.getItemById('api-test');
    if (testBtn) {
      testBtn.on('click', testApiConnection);
    }
  });
};
