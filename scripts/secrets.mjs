import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const algorithm = 'aes-256-gcm';

function decodeKey(value) {
  if (!value) {
    throw new Error('BALDE_SECRET_KEY is not set');
  }

  const normalized = value.replace(/^base64:/, '');
  const key = Buffer.from(normalized, 'base64');
  if (key.length !== 32) {
    throw new Error('BALDE_SECRET_KEY must be 32 bytes encoded as base64');
  }

  return key;
}

export function generateSecretKey() {
  return randomBytes(32).toString('base64');
}

export async function encryptSecret({ plaintext, outputPath, secretKey = process.env.BALDE_SECRET_KEY, label = 'secret' }) {
  if (!plaintext) {
    throw new Error('Missing plaintext secret');
  }

  const key = decodeKey(secretKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    version: 1,
    algorithm,
    label,
    createdAt: new Date().toISOString(),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export async function decryptSecret({ inputPath, secretKey = process.env.BALDE_SECRET_KEY }) {
  const key = decodeKey(secretKey);
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  if (payload.algorithm !== algorithm) {
    throw new Error(`Unsupported secret algorithm: ${payload.algorithm}`);
  }

  const decipher = createDecipheriv(algorithm, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];

  if (command === 'generate-key') {
    process.stdout.write(generateSecretKey());
  } else if (command === 'encrypt-env') {
    const [, , , envName, outputPath, label] = process.argv;
    await encryptSecret({
      plaintext: process.env[envName],
      outputPath,
      label: label || envName
    });
    process.stdout.write(`encrypted:${outputPath}`);
  } else if (command === 'decrypt') {
    const [, , , inputPath] = process.argv;
    process.stdout.write(await decryptSecret({ inputPath }));
  } else {
    process.stderr.write('Usage: node scripts/secrets.mjs generate-key | encrypt-env <ENV_NAME> <outputPath> [label] | decrypt <inputPath>');
    process.exit(1);
  }
}
