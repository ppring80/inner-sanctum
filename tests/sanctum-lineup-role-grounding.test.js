'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../sanctum.html'), 'utf8');

assert.ok(
  source.includes("A player appearing under BENCH in the user's fantasy lineup means only that the user benched him"),
  'Trash Lord must distinguish fantasy bench placement from NFL depth-chart role'
);
assert.ok(
  source.includes("They do not establish any player\\'s real NFL depth-chart role"),
  'lineup request must explicitly ground every persona against unsupported role inference'
);
assert.ok(
  source.includes("Do not call a benched fantasy player an NFL backup, buried, demoted, or losing work"),
  'lineup request must prohibit specific unsupported role claims'
);
assert.ok(
  source.includes("unless verified role evidence is explicitly provided"),
  'role claims must require explicit verified evidence'
);

assert.ok(
  source.includes('ask(modelPrompt, visiblePrompt);'),
  'model-only grounding and the customer-visible lineup must be passed separately'
);
assert.ok(
  source.includes('displayContent: displayTxt || q'),
  'chat history must retain a clean customer-visible message'
);
assert.ok(
  source.includes('(h[j].displayContent || h[j].content)'),
  'the chat bubble must render clean display content while the API retains grounding'
);

assert.ok(
  source.includes("return { role: message.role, content: message.content };"),
  'API payload must strip UI-only displayContent before transmission'
);
assert.ok(
  !source.includes("messages: hist[ap]\n"),
  'raw UI history objects must never be sent to the model API'
);

console.log('sanctum-lineup-role-grounding.test.js passed');
