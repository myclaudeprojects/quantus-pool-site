'use strict';

const { getDb } = require('./index');
const config = require('../config');

const database = getDb();
console.log('SQLite ready at', config.databasePath);
const tables = database
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all();
console.log(
  'Tables:',
  tables.map((t) => t.name).join(', ')
);
