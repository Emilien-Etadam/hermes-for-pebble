module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: '<b>Première fois :</b> serveur + clé API ci-dessous → Enregistrer.<br><b>Ensuite :</b> bouton <b>UP</b> sur la montre = appairage automatique (plus de terminal).'
  },
  {
    type: 'section',
    items: [
      {
        type: 'input',
        messageKey: 'PAIRING_SERVER',
        label: 'Serveur Hermes',
        defaultValue: '',
        attributes: {
          placeholder: '192.168.1.10:8642'
        }
      },
      {
        type: 'input',
        messageKey: 'PAIRING_KEY',
        label: 'Clé API serveur',
        defaultValue: '',
        attributes: {
          type: 'password',
          placeholder: 'API_SERVER_KEY (~/.hermes/.env)'
        }
      }
    ]
  },
  {
    type: 'button',
    id: 'api-test',
    primary: true,
    defaultValue: 'Tester l’API'
  },
  {
    type: 'text',
    id: 'api-test-status',
    defaultValue: 'Vérifie que le téléphone atteint le serveur Hermes.'
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
