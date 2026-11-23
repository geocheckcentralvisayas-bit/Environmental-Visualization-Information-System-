#!/usr/bin/env node
/**
 * Serves the dashboard to other computers on the same network.
 *
 * Vite binds to 0.0.0.0 instead of localhost. The API stays on 127.0.0.1 and is
 * reached through Vite's `/api` proxy, so the Worker is never exposed directly
 * to the network. Cookies therefore stay same-origin and logins keep working.
 *
 * The Worker accepts these private-network origins only because
 * `ALLOW_LAN_ORIGINS = "true"` is set in `worker/.dev.vars` (git-ignored).
 *
 *   npm run dev:lan
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ENVIS_PORT || 5173);
const VITE_BIN = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function lanAddresses() {
  const found = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

const addresses = lanAddresses();
console.log('');
console.log('  ENVIS Dashboard — shared on this network');
console.log('  ----------------------------------------');
console.log(`  This computer   http://localhost:${PORT}`);
for (const { name, address } of addresses) {
  console.log(`  Colleagues      http://${address}:${PORT}   (${name})`);
}
if (!addresses.length) {
  console.log('  No LAN address detected. Check that this computer is connected to the network.');
}
console.log('');
console.log('  Press Ctrl+C to stop.');
console.log('');

const child = spawn(
  process.execPath,
  [VITE_BIN, '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 0));
