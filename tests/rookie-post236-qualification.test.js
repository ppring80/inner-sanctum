"use strict";
const assert = require('node:assert/strict');
const { hash } = require('../netlify/functions/_super-sage-shadow-llm');
const { POST236, ROLE_SYSTEM, VERSION } = require('../netlify/functions/_super-sage-shadow-fast-review');
assert.equal(POST236.promptHash, '2a2fab27d864937b8481f7cdca402ee64a5083ac6778daa7f382aa0b338ac229');
assert.notEqual(hash(ROLE_SYSTEM), POST236.promptHash, 'old allowance cannot migrate to the new prompt');
assert.equal(POST236.caseId, 'fresh-role-post236');
assert.equal(VERSION, 'rookie-fast-pair-v6-haiku');
console.log('Post236 qualification pin preserved; current prompt uses a distinct bounded qualification, never a namespace reset.');
