#!/usr/bin/env node
// Phase 9 follow-up: encrypted backup archive using Node.js built-in crypto
// No external tools required. Uses AES-256-GCM with PBKDF2 key derivation.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, stat, unlink, existsSync } from 'node:fs';
import { promisify } from 'node:util';
const statAsync = promisify(stat);
const unlinkAsync = promisify(unlink);
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function pbkdf2Key(passphrase, salt, iterations, length) {
  const encoder = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
}

async function createTarGz(inputDir, outputFile) {
  const outDir = dirname(outputFile);
  const input = isAbsolute(inputDir) ? inputDir : join(process.cwd(), inputDir);
  const output = isAbsolute(outputFile) ? outputFile : join(process.cwd(), outputFile);
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', output, '-C', input, '.']);
    let stderr = '';
    tar.stderr.on('data', (data) => { stderr += data.toString(); });
    tar.on('close', (code) => {
      if (code !== 0) reject(new Error(`tar failed: ${stderr}`));
      else resolve(output);
    });
  });
}

async function encryptFile(inputFile, outputFile, passphrase) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const key = await pbkdf2Key(passphrase, salt, 600000, 32);
  const cryptoKey = await key;
  const input = createReadStream(inputFile, { highWaterMark: 64 * 1024 });
  const output = createWriteStream(outputFile);
  output.write(salt);
  output.write(iv);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const done = (err) => { if (err) reject(err); else resolve(); };
    input.on('error', done);
    output.on('error', done);
    input.on('data', async (chunk) => {
      const encrypted = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        chunk,
      );
      chunks.push(Buffer.from(encrypted));
    });
    input.on('end', async () => {
      const final = await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new Uint8Array(0),
      );
      if (final.byteLength > 0) chunks.push(Buffer.from(final));
      output.write(Buffer.concat(chunks));
      output.end();
      done();
    });
  });
}

async function main() {
  const passphrase = process.argv[2];
  if (!passphrase) {
    console.error('Usage: node scripts/backup-encrypt.mjs <passphrase> [input-dir] [output-file]');
    process.exit(1);
  }
  const inputDir = process.argv[3] || join(__dirname, '..', '.local', 'restore-test');
  const outputFile = process.argv[4] || join(__dirname, '..', '.local', 'restore-test', 'backup.tar.gz.enc');

  if (!existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  console.log('[backup-encrypt] Creating backup archive...');
  const tarFile = outputFile.replace(/\.enc$/, '') + '.tar.gz';
  await createTarGz(inputDir, tarFile);
  console.log(`[backup-encrypt] Archive created: ${tarFile}`);

  const stats = await statAsync(tarFile);
  console.log(`[backup-encrypt] Archive size: ${stats.size} bytes`);

  console.log('[backup-encrypt] Encrypting with AES-256-GCM...');
  await encryptFile(tarFile, outputFile, passphrase);
  console.log(`[backup-encrypt] Encrypted backup: ${outputFile}`);

  await unlinkAsync(tarFile);
  console.log('[backup-encrypt] Removed unencrypted archive');

  console.log('SUCCESS: Backup encrypted successfully');
  console.log(`Output: ${outputFile}`);
  console.log('Store the passphrase securely - it cannot be recovered');
}

main();
