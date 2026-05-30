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
        defaultValue: '',
        attributes: {
          placeholder: 'http://HOST:8642/v1/chat/completions'
        }
      },
      {
        type: 'input',
        messageKey: 'HERMES_KEY',
        label: 'Clé (Bearer)',
        defaultValue: '',
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
