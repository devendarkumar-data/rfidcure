// Creates (or resets) a Super Admin directly in the Google Sheet. Run once after setup:
//   npm run create-admin -- --user admin --name "Your Name" [--branch ""]
// The password is read from the ADMIN_PASSWORD environment variable or typed at the prompt; only a bcrypt hash is stored.
import bcrypt from 'bcryptjs';
import { sheetsStore, arg, ask } from './_env.js';
import { checkPasswordPolicy } from '../server/auth.js';
const id = arg('user') || await ask('User ID: '); const name = arg('name') || await ask('Full name: ');
const pw = process.env.ADMIN_PASSWORD || await ask('Password (min 8, letters + numbers): ', { hidden: true });
checkPasswordPolicy(pw, { 'Minimum Password Length': 8 }, id);
const store = await sheetsStore();
const users = await store.read('Users'); const creds = await store.read('Credentials');
const u = users.rows.find((r) => String(r['User ID']).toLowerCase() === id.toLowerCase());
const c = creds.rows.find((r) => String(r['User ID']).toLowerCase() === id.toLowerCase());
const hash = await bcrypt.hash(pw, 10), stamp = new Date().toISOString();
const credRow = { 'Password Hash': hash, 'Must Change Password': 'No', 'Failed Attempts': 0, 'Locked Until': '', 'Password Updated': stamp };
if (u) await store.updateRow('Users', u.__row, { 'User Name': name, Role: 'Super Admin', Status: 'Active' }); else await store.append('Users', [{ 'User ID': id, 'User Name': name, Role: 'Super Admin', Branch: arg('branch') || '', Status: 'Active', 'Last Login': '' }]);
if (c) await store.updateRow('Credentials', c.__row, credRow); else await store.append('Credentials', [{ 'User ID': id, Email: '', ...credRow }]);
console.log(`Super Admin "${id}" is ready. Sign in, then create the other users from Administration > Users.`);
