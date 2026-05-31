module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Configurez l\'app via l\'appairage automatique. L\'URL, la clé et la session sont enregistrées sur le téléphone après un appairage réussi — elles ne s\'affichent pas ici.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Appairage'
      },
      {
        type: 'text',
        defaultValue: '<ol><li>Indiquez l\'adresse du serveur (IP:8642) ci-dessous → Enregistrer.</li><li>Montre : <b>UP</b> → notez le code (ex. ABCD).</li><li><b>Terminal PC</b> (pas le chat Hermes) :<br><code>API_SERVER_KEY=xxx ./scripts/pebble-pair.sh ABCD IP:8642</code><br>Clé = <code>API_SERVER_KEY</code> dans <code>~/.hermes/.env</code>.</li><li>Montre : « OK » → SELECT.</li></ol><p><b>/pair</b> n\'existe pas dans le chat Hermes.</p>'
      },
      {
        type: 'input',
        messageKey: 'PAIRING_SERVER',
        label: 'Serveur Hermes (IP:port)',
        defaultValue: '',
        attributes: {
          placeholder: 'IP:8642'
        }
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Enregistrer'
  }
];
