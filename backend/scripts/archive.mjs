import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

const src = process.argv[2] || '.';
const out = process.argv[3] || resolve('backups', 'archive.tar.gz');
const tar = spawn('tar', ['-czf', out, '-C', src, '.']);
let stderr = '';
tar.stderr.on('data', (d) => (stderr += d.toString()));
tar.on('exit', (code) => {
  if (code !== 0) {
    console.error('tar failed:', stderr);
    process.exit(code ?? 1);
  }
  console.log(`Archive written to ${out}`);
});
