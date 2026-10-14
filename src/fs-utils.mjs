// Tiny shared filesystem helpers (modularization). Leaf module — no app deps.
import { stat } from 'node:fs/promises';

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
