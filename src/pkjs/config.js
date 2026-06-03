var TERMINAL_STYLE =
  'font-family:monospace;font-size:10px;line-height:1.3;' +
  'background:#111;color:#bbb;padding:6px;border-radius:4px;' +
  'border:1px solid #333;max-height:160px;overflow-y:auto;' +
  'white-space:pre-wrap;word-break:break-word;';

module.exports = [
  {
    type: 'heading',
    defaultValue: 'Hermes for Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Set server & API key → <b>Test</b> → <b>Save</b> (required). Watch: <b>SELECT</b> speak, <b>Up/Down</b> scroll, <b>BACK long</b> history browse.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'input',
        messageKey: 'HERMES_SERVER',
        label: 'Server',
        defaultValue: '',
        attributes: {
          placeholder: '192.168.1.10:8642'
        }
      },
      {
        type: 'input',
        messageKey: 'HERMES_KEY',
        label: 'API key',
        defaultValue: '',
        attributes: {
          type: 'password',
          placeholder: 'API key'
        }
      },
      {
        type: 'input',
        messageKey: 'MODEL',
        label: 'Model',
        defaultValue: 'hermes',
        attributes: {
          placeholder: 'hermes'
        }
      },
      {
        type: 'input',
        messageKey: 'SESSION_KEY',
        label: 'Session',
        defaultValue: '',
        attributes: {
          placeholder: 'pebble:you'
        }
      },
      {
        type: 'toggle',
        messageKey: 'NO_THINK',
        label: 'Fast replies',
        description: 'Short answers, 45s limit. Server: agent.reasoning_effort: none, max_turns: 5',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'VIBRATE_ON',
        label: 'Vibration alerts',
        description: 'Buzz on reply ready and errors',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'HISTORY_ON',
        label: 'Local history',
        description: 'Save exchanges on phone for BACK long on watch',
        defaultValue: true
      },
      {
        type: 'select',
        messageKey: 'HISTORY_MAX',
        label: 'History size',
        defaultValue: '10',
        options: [
          { value: '5', label: '5 exchanges' },
          { value: '10', label: '10 exchanges' },
          { value: '20', label: '20 exchanges' }
        ]
      }
    ]
  },
  {
    type: 'button',
    id: 'api-test',
    primary: true,
    defaultValue: 'Test connection'
  },
  {
    type: 'text',
    id: 'api-test-status',
    defaultValue:
      '<div style="' + TERMINAL_STYLE + '">Connection log. Voice chat runs on the watch (SELECT).</div>'
  },
  {
    type: 'button',
    id: 'copy-logs',
    defaultValue: 'Copy log'
  },
  {
    type: 'submit',
    defaultValue: 'Save'
  }
];
