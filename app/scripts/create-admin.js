// Usage: node scripts/create-admin.js admin@example.com 'a-strong-password'
// Re-running with an existing email resets that admin's password.
import { db, run, one, now } from '../lib/db.js';
import { hashPassword, isEmail } from '../lib/util.js';

const [email, pw] = process.argv.slice(2);
if (!isEmail(email || '') || !pw || pw.length < 12) {
  console.error('Usage: node scripts/create-admin.js <email> <password (min 12 chars)>');
  process.exit(1);
}
const hash = await hashPassword(pw);
const e = email.toLowerCase();
if (one('SELECT 1 x FROM admins WHERE email = ?', e)) {
  run('UPDATE admins SET pass_hash = ? WHERE email = ?', hash, e);
  run("DELETE FROM sessions WHERE kind = 'admin'");
  console.log('Updated admin password for', e);
} else {
  run('INSERT INTO admins (email, pass_hash, created_at) VALUES (?,?,?)', e, hash, now());
  console.log('Created admin', e);
}
db.close();
