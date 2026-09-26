'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const newswire = require('../netlify/functions/sage-newswire');

// Provenance rule: every story must link to its ORIGINAL source. When this
// test was written every story came from a reporter's X post. Official NFL
// injury reports are also primary sources for injury designations.
const APPROVED_SOURCES = [
  { url: /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/, label: /( on X$| via )/ },
  { url: /^https:\/\/www\.nfl\.com\/injuries\/$/, label: /^NFL .*injury report$/ }
];

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
    assert(
      APPROVED_SOURCES.some((source) => source.url.test(story.sourceUrl) && source.label.test(story.sourceLabel)),
      `Story ${story.id} must link to an approved original source (X post or official NFL injury report) with a matching label; got ${story.sourceLabel} <${story.sourceUrl}>`
    );
  });

  const rejected = await newswire.handler({ httpMethod: 'POST' });
  assert.strictEqual(rejected.statusCode, 405);

  console.log('sage-newswire.test.js: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
