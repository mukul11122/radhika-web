const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { document: { addEventListener() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/track.js'), 'utf8'), context);
assert(context.dispatchTime('13/11/2026') > context.dispatchTime('24/10/2026'));
assert(context.dispatchTime('08/10/2026') > context.dispatchTime('14/9/2026'));
assert.equal(context.dispatchTime(''), -Infinity);
const card = context.docketCard({
  docketNo: '<example>',
  courier: 'OLS LOGISTICS',
  dispatchDate: '13/11/2026',
});
assert(card.includes('<article'));
assert(card.includes('https://www.olslogistics.in/tracking'));
assert(card.includes('&lt;example&gt;'));
console.log('Tracking tiles, date order, escaping and courier link passed.');
