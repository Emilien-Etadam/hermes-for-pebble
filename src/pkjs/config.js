module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Configurez l\'app via l\'appairage automatique (recommandé) ou manuellement ci-dessous.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Appairage automatique'
      },
      {
        type: 'text',
        defaultValue: '<ol><li>Indiquez l\'adresse IP du serveur Hermes (port 8642).</li><li>Sur la montre : bouton <b>UP</b> pour lancer l\'appairage.</li><li>Notez le code à 4 caractères affiché.</li><li>Sur votre PC, dans le CLI Hermes : <code>/pair CODE</code></li><li>Attendez « OK » sur la montre, puis appuyez sur SELECT.</li></ol>'
      },
      {
        type: 'input',
        messageKey: 'PAIRING_SERVER',
        label: 'Serveur Hermes (IP:port)',
        defaultValue: '',
        attributes: {
          placeholder: '192.168.1.10:8642'
        }
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Configuration manuelle'
      },
      {
        type: 'text',
        defaultValue: 'Rempli automatiquement après un appairage réussi. Vous pouvez aussi saisir ces valeurs à la main.'
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
          type: 'password',
          placeholder: 'Clé API_SERVER_KEY du serveur'
        }
      },
      {
        type: 'input',
        messageKey: 'SESSION_KEY',
        label: 'Session',
        defaultValue: '',
        attributes: {
          placeholder: 'ex. pebble:monnom'
        }
      },
      {
        type: 'input',
        messageKey: 'MODEL',
        label: 'Modèle',
        defaultValue: '',
        attributes: {
          placeholder: 'ex. hermes'
        }
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
