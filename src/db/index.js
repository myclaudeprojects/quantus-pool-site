'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { ensureOperatorSeed } = require('../services/operatorSeed');

let db;

function getDb() {
  if (db) return db;
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS miners (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      miner_label TEXT,
      api_key_hash TEXT NOT NULL,
      api_key_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat_at TEXT,
      last_hashrate REAL DEFAULT 0,
      total_shares REAL DEFAULT 0,
      pending_qtc REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_miners_wallet ON miners(wallet_address);

    CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      miner_id TEXT NOT NULL REFERENCES miners(id) ON DELETE CASCADE,
      hashrate REAL NOT NULL DEFAULT 0,
      shares REAL NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_heartbeats_miner ON heartbeats(miner_id);

    CREATE TABLE IF NOT EXISTS download_grants (
      token TEXT PRIMARY KEY,
      wallet_address TEXT,
      expires_at INTEGER NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claim_requests (
      id TEXT PRIMARY KEY,
      miner_id TEXT NOT NULL REFERENCES miners(id),
      wallet_address TEXT NOT NULL,
      amount_qtc REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS pool_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recent_blocks (
      height INTEGER PRIMARY KEY,
      found_at TEXT NOT NULL,
      pool_share REAL NOT NULL DEFAULT 1,
      hash TEXT
    );
  `);

  const insertMeta = database.prepare(
    `INSERT OR IGNORE INTO pool_meta (key, value) VALUES (?, ?)`
  );
  insertMeta.run('blocks_attributed', '0');
  insertMeta.run('blocks_mined', '0');
  insertMeta.run('blocks_source', 'demo');
  insertMeta.run('pool_balance_qtc', '0');
  insertMeta.run('schema_version', '1');
  insertMeta.run('recent_accrual_qtc', String(config.demoPoolAccrualQtc));

  seedDemoBlocks(database);
  ensureOperatorSeed(database);
}

/** Seed placeholder blocks so the visual has something to show pre-indexer. */
function seedDemoBlocks(database) {
  const count = database.prepare(`SELECT COUNT(*) AS c FROM recent_blocks`).get().c;
  if (count > 0) return;

  const demo = [
    { height: 184201, minsAgo: 12, share: 1.0, hash: '0x7a3c…f21e' },
    { height: 184188, minsAgo: 48, share: 1.0, hash: '0xb914…09aa' },
    { height: 184160, minsAgo: 130, share: 0.92, hash: '0x01ef…cc40' },
    { height: 184102, minsAgo: 310, share: 1.0, hash: '0xd2aa…7711' },
    { height: 184055, minsAgo: 520, share: 0.85, hash: '0x88c0…ab3d' },
    { height: 183990, minsAgo: 900, share: 1.0, hash: '0x44f1…9002' },
  ];

  const ins = database.prepare(
    `INSERT INTO recent_blocks (height, found_at, pool_share, hash) VALUES (?, ?, ?, ?)`
  );
  const tx = database.transaction(() => {
    for (const b of demo) {
      const foundAt = new Date(Date.now() - b.minsAgo * 60 * 1000).toISOString();
      ins.run(b.height, foundAt, b.share, b.hash);
    }
    database
      .prepare(`INSERT OR REPLACE INTO pool_meta (key, value) VALUES ('blocks_mined', ?)`)
      .run(String(demo.length + 42));
    database
      .prepare(`INSERT OR REPLACE INTO pool_meta (key, value) VALUES ('blocks_attributed', ?)`)
      .run(String(demo.length + 42));
    database
      .prepare(`INSERT OR REPLACE INTO pool_meta (key, value) VALUES ('blocks_source', 'demo')`)
      .run();
  });
  tx();
}

module.exports = { getDb };
