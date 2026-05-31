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
        defaultValue: '<ol><li>Indiquez l\'adresse du serveur Hermes (IP:8642).</li><li>Sur la montre : bouton <b>UP</b> pour lancer l\'appairage.</li><li>Notez le code à 4 caractères affiché.</li><li>Sur votre PC, CLI Hermes : <code>/pair CODE</code></li><li>Attendez « OK » sur la montre, puis SELECT.</li></ol>'
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
