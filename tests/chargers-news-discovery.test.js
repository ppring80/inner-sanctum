'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {indexCards}=require('../netlify/functions/_chargers-news-discovery');
const html=fs.readFileSync(path.join(__dirname,'fixtures/chargers-all-news-card-contract.html'),'utf8');
const cards=indexCards(html);assert.equal(cards.length,80);
assert.equal(cards[12].url,'https://www.chargers.com/news/rashawn-slater-injury-update');
assert.throws(()=>indexCards(html.replace('13:80','12:80')),/missing, duplicated/);
assert.throws(()=>indexCards(html.replace('"Skip":0','"Skip":1')),/contract/);
console.log('PASS: Chargers full-news index includes Slater outside transaction category and rejects missing/reordered pages.');
