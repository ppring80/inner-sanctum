'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const newswire = require('../netlify/functions/sage-newswire');

async function run() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'weekly.html'), 'utf8');

  assert(page.includes('id="newswireTitle"'), 'Weekly page should include the Newswire heading');
  assert(page.includes("setNewswireView('roster')"), 'Weekly page should include the My Players view');
  assert(page.includes('More NFL News'), 'Weekly page should include the compact chronological feed');
  assert(page.includes('loadMoreNewswire()'), 'Weekly page should support progressive loading');
  assert(page.includes("setNewswirePosition('RB')"), 'Weekly page should include position filters');
  assert(page.includes("/.netlify/functions/sage-newswire"), 'Weekly page should load the Newswire endpoint');
  assert(page.includes('SAGE Impact'), 'Newswire cards should explain the fantasy impact');

  const response = await newswire.handler({ httpMethod: 'GET' });
  assert.strictEqual(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert(Array.isArray(body.stories) && body.stories.length >= 7, 'Newswire should return featured and compact stories');
  assert.strictEqual(body.stories.filter((story) => story.featured).length, 3, 'Newswire should identify three featured stories');
  body.stories.forEach((story) => {
    ['player', 'headline', 'summary', 'sageImpact', 'sourceLabel', 'sourceUrl', 'publishedAt'].forEach((field) => {
      assert(story[field], `Story ${story.id || '(unknown)'} is missing ${field}`);
    });
    assert(/^https:\/\/x\.com\//.test(story.sourceUrl), 'Each current story should link to its original X source');
  });

  const rejected = await newswire.handler({ httpMethod: 'POST' });
  assert.strictEqual(rejected.statusCode, 405);

  console.log('sage-newswire.test.js: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
