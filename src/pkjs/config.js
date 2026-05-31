module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: '<b>Première fois :</b> serveur + clé API + modèle <b>hermes</b> → Enregistrer.<br><b>Ensuite :</b> bouton <b>UP</b> sur la montre = appairage, ou dictée directe si Settings OK.'
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
      },
      {
        type: 'input',
        messageKey: 'MODEL',
        label: 'Modèle',
        defaultValue: 'hermes',
        attributes: {
          placeholder: 'hermes'
        }
      },
      {
        type: 'input',
        messageKey: 'SESSION_KEY',
        label: 'Session (mémoire)',
        defaultValue: '',
        attributes: {
          placeholder: 'pebble:emilien'
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
    type: 'heading',
    defaultValue: 'Mise à jour'
  },
  {
    type: 'text',
    id: 'app-version',
    defaultValue: 'Version installée : …'
  },
  {
    type: 'button',
    id: 'update-check',
    defaultValue: 'Vérifier les mises à jour'
  },
  {
    type: 'button',
    id: 'update-download',
    primary: true,
    defaultValue: 'Installer la mise à jour'
  },
  {
    type: 'text',
    id: 'update-status',
    defaultValue: 'Contrôle automatique au chargement.'
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
