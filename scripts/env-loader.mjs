import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadLocalEnv(rootDir = process.cwd()) {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = join(rootDir, fileName);
    let content = '';

    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separator = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
