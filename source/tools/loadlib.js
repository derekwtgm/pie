// Shared loader for the offline chart generators and regression checks.
const path = require('path');
const libs = ['lib_cards', 'lib_eval', 'lib_pots', 'lib_icm', 'lib_information', 'lib_checkpoint', 'lib_eqdata', 'lib_pushfold', 'lib_fgs'];
for (const name of libs) require(path.join(__dirname, '../web', name + '.js'));
for (const name of (process.env.EXTRA_LIBS || '').split(',').filter(Boolean))
  require(path.join(__dirname, '../web', name));
module.exports = globalThis.EM;
