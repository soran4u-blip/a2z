// Consistent online backup of the SQLite database, keeps the newest 14 copies.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../lib/config.js';

const dir = process.env.BACKUP_DIR || path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `a2z-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new DatabaseSync(config.dbPath);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('a2z-')).sort().reverse().slice(14)) fs.unlinkSync(path.join(dir, f));
console.log('backup written', file);
