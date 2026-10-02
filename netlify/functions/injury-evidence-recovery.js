'use strict';
// HTTP recovery has the same authentication, lease and freshness protections.
// Netlify scheduled functions cannot be invoked directly by URL.
const collector=require('./refresh-injury-transactions');
// This HTTP route never accepts scheduler-shaped bodies as authorization.
exports.handler=event=>collector.handler({...event,httpMethod:'GET'});
