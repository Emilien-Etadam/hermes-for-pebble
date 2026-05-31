module.exports = function() {
  var clayConfig = this;
  var HTTP_TIMEOUT_MS = 10000;
  var latestDownloadUrl = null;
  var latestReleasePageUrl = null;

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

  function getHermesUrlBase(url) {
    if (!url) {
      return '';
    }
    var base = String(url).replace(/\/v1\/chat\/completions\/?$/, '');
    return base.replace(/\/+$/, '');
  }

  function getServerUrl() {
    var serverItem = clayConfig.getItemByMessageKey('PAIRING_SERVER');
    var server = pickString(serverItem ? serverItem.get() : '');
    var stored = getStoredSettings();

    if (!server) {
      server = pickString(stored.PAIRING_SERVER);
    }
    if (!server) {
      return getHermesUrlBase(pickString(stored.HERMES_URL));
    }

    server = server.replace(/\/+$/, '');
    if (server.indexOf('://') === -1) {
      server = 'http://' + server;
    }
    return server;
  }

  function getApiKey() {
    var keyItem = clayConfig.getItemByMessageKey('PAIRING_KEY');
    var key = pickString(keyItem ? keyItem.get() : '');
    var stored = getStoredSettings();

    if (key) {
      return key;
    }
    return pickString(stored.PAIRING_KEY) || pickString(stored.HERMES_KEY);
  }

  function setApiTestStatus(text) {
    var statusItem = clayConfig.getItemById('api-test-status');
    if (statusItem) {
      statusItem.set(text);
    }
  }

  function setUpdateStatus(text) {
    var statusItem = clayConfig.getItemById('update-status');
    if (statusItem) {
      statusItem.set(text);
    }
  }

  function parseVersion(version) {
    return String(version).replace(/^v/i, '').split('.').map(function(part) {
      return parseInt(part, 10) || 0;
    });
  }

  function compareVersions(left, right) {
    var leftParts = parseVersion(left);
    var rightParts = parseVersion(right);
    var length = Math.max(leftParts.length, rightParts.length);

    for (var i = 0; i < length; i += 1) {
      var diff = (leftParts[i] || 0) - (rightParts[i] || 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }

  function getInstalledVersion() {
    if (clayConfig.meta.userData && clayConfig.meta.userData.version) {
      return pickString(clayConfig.meta.userData.version);
    }
    return '0.0.0';
  }

  function getReleaseRepo() {
    if (clayConfig.meta.userData && clayConfig.meta.userData.repo) {
      return pickString(clayConfig.meta.userData.repo);
    }
    return 'Emilien-Etadam/hermes-for-pebble';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openExternalUrl(url) {
    var link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function buildDownloadHelpHtml() {
    var parts = [];

    if (latestDownloadUrl) {
      parts.push(
        '<a href="' + escapeHtml(latestDownloadUrl) + '" target="_blank" rel="noopener">' +
        'Télécharger le .pbw</a>'
      );
    }

    if (latestReleasePageUrl) {
      parts.push(
        '<a href="' + escapeHtml(latestReleasePageUrl) + '" target="_blank" rel="noopener">' +
        'Page release GitHub</a>'
      );
    }

    if (!parts.length) {
      return '';
    }

    return 'Si l’installation ne démarre pas, touchez :<br>' + parts.join('<br>');
  }

  function findPbwAsset(release) {
    if (!release || !release.assets) {
      return null;
    }

    for (var i = 0; i < release.assets.length; i += 1) {
      var asset = release.assets[i];
      if (asset.name && asset.name.indexOf('.pbw') !== -1) {
        return asset.browser_download_url;
      }
    }
    return null;
  }

  function setDownloadAvailable(available, downloadUrl, latestVersion, releasePageUrl) {
    latestDownloadUrl = available ? downloadUrl : null;
    latestReleasePageUrl = available ? releasePageUrl : null;
    var downloadBtn = clayConfig.getItemById('update-download');
    if (!downloadBtn) {
      return;
    }

    if (available) {
      downloadBtn.show();
      downloadBtn.set('Installer v' + latestVersion);
    } else {
      downloadBtn.hide();
      downloadBtn.set('Installer la mise à jour');
      latestReleasePageUrl = null;
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

  function checkForUpdates() {
    var installedVersion = getInstalledVersion();
    var checkBtn = clayConfig.getItemById('update-check');
    var apiUrl = 'https://api.github.com/repos/' + getReleaseRepo() + '/releases/latest';

    setUpdateStatus('Vérification…');
    setDownloadAvailable(false);
    if (checkBtn) {
      checkBtn.disable();
    }

    function finish(message, isSuccess) {
      if (checkBtn) {
        checkBtn.enable();
      }
      var color = isSuccess ? '#080' : '#c00';
      setUpdateStatus('<span style="color:' + color + '">' + message + '</span>');
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = HTTP_TIMEOUT_MS;
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');

    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var release = JSON.parse(xhr.responseText);
          var latestVersion = pickString(release.tag_name).replace(/^v/i, '');
          var downloadUrl = findPbwAsset(release);

          if (!latestVersion) {
            finish('Release GitHub invalide', false);
            return;
          }

          if (compareVersions(latestVersion, installedVersion) > 0) {
            var releasePageUrl = pickString(release.html_url);
            if (downloadUrl || releasePageUrl) {
              setDownloadAvailable(true, downloadUrl, latestVersion, releasePageUrl);
              finish(
                'Mise à jour v' + latestVersion + ' disponible.<br>' + buildDownloadHelpHtml(),
                true
              );
            } else {
              finish('Mise à jour v' + latestVersion + ' sans fichier .pbw.', false);
            }
            return;
          }

          setDownloadAvailable(false);
          finish('À jour (v' + installedVersion + ').', true);
          return;
        } catch (err) {
          finish('Réponse GitHub invalide', false);
          return;
        }
      }

      if (xhr.status === 404) {
        finish('Aucune release publiée', false);
        return;
      }

      finish('GitHub HTTP ' + xhr.status, false);
    };

    xhr.onerror = function() {
      finish('Impossible de joindre GitHub', false);
    };

    xhr.ontimeout = function() {
      finish('Délai dépassé', false);
    };

    xhr.send();
  }

  function downloadLatestUpdate() {
    var openUrl = latestReleasePageUrl || latestDownloadUrl;

    if (!openUrl) {
      setUpdateStatus('<span style="color:#c00">Aucune mise à jour disponible</span>');
      return;
    }

    try {
      openExternalUrl(openUrl);
    } catch (err) {
      console.log('openExternalUrl failed: ' + err);
    }

    setUpdateStatus(
      '<span style="color:#080">Ouverture dans le navigateur…</span><br>' +
      buildDownloadHelpHtml()
    );
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function() {
    var installedVersion = getInstalledVersion();
    var versionItem = clayConfig.getItemById('app-version');
    if (versionItem) {
      versionItem.set('Version installée : <b>v' + installedVersion + '</b>');
    }

    var testBtn = clayConfig.getItemById('api-test');
    if (testBtn) {
      testBtn.on('click', testApiConnection);
    }

    var checkBtn = clayConfig.getItemById('update-check');
    if (checkBtn) {
      checkBtn.on('click', checkForUpdates);
    }

    var downloadBtn = clayConfig.getItemById('update-download');
    if (downloadBtn) {
      downloadBtn.hide();
      downloadBtn.on('click', downloadLatestUpdate);
    }

    checkForUpdates();
  });
};
