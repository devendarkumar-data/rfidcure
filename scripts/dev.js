import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const api = run('node', ['server/dev.js']);
const web = run('npx', ['vite']);
const stop = () => { api.kill(); web.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
api.on('exit', (c) => { web.kill(); process.exit(c ?? 0); });
