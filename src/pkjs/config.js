module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Configurez le serveur ici, testez la <b>connexion</b>, puis <b>Enregistrer</b>. Sur la montre : <b>SELECT</b> pour parler à Hermes (vrai chat, pas un test).'
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
      },
      {
        type: 'toggle',
        messageKey: 'NO_THINK',
        label: 'Réponse rapide (sans réflexion)',
        defaultValue: true
      },
      {
        type: 'text',
        defaultValue: 'Si coché : <code>reasoning_effort: none</code> et <code>think: false</code> — réponses plus courtes et plus rapides sur Hermes / Ollama.'
      }
    ]
  },
  {
    type: 'button',
    id: 'api-test',
    primary: true,
    defaultValue: 'Tester la connexion'
  },
  {
    type: 'text',
    id: 'api-test-status',
    defaultValue: '<div style="font-family:monospace;font-size:11px;background:#111;color:#888;padding:10px;border-radius:6px;border:1px solid #333;">Journal connexion (GET /health, /v1/models). Le chat Hermes se fait sur la montre via SELECT.</div>'
  },
  {
    type: 'button',
    id: 'copy-logs',
    defaultValue: 'Copier les logs'
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
