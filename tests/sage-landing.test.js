const assert = require('assert');
const fs = require('fs');

const home = fs.readFileSync('index.html', 'utf8');
const landing = fs.readFileSync('sage.html', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

assert(!home.includes('Inner Sanctum SAGE inside ChatGPT — coming soon'));
assert(home.includes('href="/sage"'));
assert(landing.includes('class="nav-link home" href="/">Home</a>'));
assert(landing.includes('Rankings built for <em>this week.</em>'));
assert(landing.includes('/.netlify/functions/weekly-sage-rankings'));
assert(landing.includes("var CHATGPT_APP_URL='https://chatgpt.com/plugins/plugin_asdk_app_6a99edc0ddfc8191af5dcd6c73e2f752'"));
assert(landing.includes('Open SAGE in ChatGPT'));
assert(landing.includes('Click <strong>Try in chat</strong>'));
assert(landing.includes("fbq('trackCustom','SageChatGPTClick')"));
assert(landing.includes('No subscription or connected league required'));
assert(sitemap.includes('https://theinnersanctum.xyz/sage'));

console.log('SAGE landing page regression tests passed.');
