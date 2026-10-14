'use strict';
const assert=require('node:assert/strict'),{officialUrl,clubs}=require('../netlify/functions/_official-club-transactions');
assert.equal(clubs.find(c=>c.team==='TEN').origin,'https://www.tennesseetitans.com');
for(const origin of ['https://www.tennesseetitans.com','https://tennesseetitans.com'])assert.equal(officialUrl(origin+'/news/','TEN'),origin+'/news/');
for(const url of ['https://www.tennesseetitans.com.example.org/news/','https://user:pass@www.tennesseetitans.com/news/','http://www.tennesseetitans.com/news/'])assert.throws(()=>officialUrl(url,'TEN'));
assert.throws(()=>officialUrl('https://www.tennesseetitans.com/news/','PHI'));
console.log('PASS: verified canonical Titans host, old provenance retained, wrong team/lookalike/credentialed/insecure URLs rejected.');
