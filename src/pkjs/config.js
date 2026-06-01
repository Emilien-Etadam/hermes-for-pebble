module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Serveur Hermes + clé API + modèle → Enregistrer. Puis <b>SELECT</b> sur la montre pour parler.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'input',
        messageKey: 'HERMES_SERVER',
        label: 'Serveur Hermes',
        defaultValue: '',
        attributes: {
          placeholder: '192.168.1.10:8642'
        }
      },
      {
        type: 'input',
        messageKey: 'HERMES_KEY',
        label: 'Clé API',
        defaultValue: '',
        attributes: {
          type: 'password',
          placeholder: 'API_SERVER_KEY'
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
    defaultValue: 'Tester la connexion'
  },
  {
    type: 'button',
    id: 'model-test',
    primary: true,
    defaultValue: 'Tester le modèle (prompt)'
  },
  {
    type: 'text',
    id: 'api-test-status',
    defaultValue: '<div style="font-family:monospace;font-size:11px;background:#111;color:#888;padding:10px;border-radius:6px;border:1px solid #333;">Journal des tests (style terminal). Chaque étape HTTP s’affiche ici.</div>'
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
