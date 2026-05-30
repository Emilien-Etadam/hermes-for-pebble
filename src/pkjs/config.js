// Auto-apply preset settings on first launch (zero-config)
(function() {
  try {
    var stored = JSON.parse(localStorage.getItem('clay-settings')) || {};
    if (!stored.HERMES_URL && !stored.HERMES_KEY) {
      localStorage.setItem('clay-settings', JSON.stringify({
        HERMES_URL: 'http://192.168.30.140:8642/v1/chat/completions',
        HERMES_KEY: '698e3bbc841346e098bc46b69d43f7b7',
        SESSION_KEY: 'pebble:emilien',
        MODEL: 'hermes'
      }));
    }
  } catch(e) {}
})();

module.exports = [
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Hermes for Pebble'
      },
      {
        type: 'input',
        messageKey: 'HERMES_URL',
        label: 'URL API Hermes',
        defaultValue: 'http://192.168.30.140:8642/v1/chat/completions',
        attributes: {
          placeholder: 'http://HOST:8642/v1/chat/completions'
        }
      },
      {
        type: 'input',
        messageKey: 'HERMES_KEY',
        label: 'Clé (Bearer)',
        defaultValue: '698e3bbc841346e098bc46b69d43f7b7',
        attributes: {
          type: 'password'
        }
      },
      {
        type: 'input',
        messageKey: 'SESSION_KEY',
        label: 'Session',
        defaultValue: 'pebble:emilien'
      },
      {
        type: 'input',
        messageKey: 'MODEL',
        label: 'Modèle',
        defaultValue: 'hermes'
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
