import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, prettyCanonicalJson, sha256 } from './canonical-json.js';
import type { P011Artifacts } from './types.js';

const MARKER_FILE = '.ltcm-p011-artifacts';
const MARKER_CONTENT = 'ltcm-p011-artifacts-v1\n';

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertManaged(target: string): Promise<void> {
  if (!(await exists(target))) return;
  const metadata = await stat(target);
  if (!metadata.isDirectory()) throw new Error('A saída P011 existente não é diretório.');
  let marker: string;
  try {
    marker = await readFile(path.join(target, MARKER_FILE), 'utf8');
  } catch {
    throw new Error('O diretório de saída existente não é gerenciado pelo P011.');
  }
  if (marker !== MARKER_CONTENT) throw new Error('Marcador P011 inválido.');
}

function jsonl(values: unknown[]): string {
  return values.length === 0 ? '' : `${values.map(canonicalJson).join('\n')}\n`;
}

export async function writeP011Artifacts(
  outputDir: string,
  artifacts: P011Artifacts,
): Promise<void> {
  await assertManaged(outputDir);
  const parent = path.dirname(outputDir);
  const name = path.basename(outputDir);
  await mkdir(parent, { recursive: true });
  const nonce = `${process.pid}-${randomUUID()}`;
  const temporary = path.join(parent, `.${name}.p011-tmp-${nonce}`);
  const backup = path.join(parent, `.${name}.p011-backup-${nonce}`);
  await mkdir(temporary, { recursive: false });
  const files = new Map<string, string>([
    ['source-validation.json', prettyCanonicalJson(artifacts.sourceValidation)],
    ['clients-candidates.jsonl', jsonl(artifacts.clients)],
    ['projects-candidates.jsonl', jsonl(artifacts.projects)],
    ['mapping-evidence.jsonl', jsonl(artifacts.mappings)],
    ['divergences.jsonl', jsonl(artifacts.divergences)],
    ['import-plan.json', prettyCanonicalJson(artifacts.importPlan)],
    ['validation-summary.json', prettyCanonicalJson(artifacts.validationSummary)],
    ['report.md', artifacts.report],
  ]);
  const outputHashes = Object.fromEntries(
    [...files.entries()].map(([relative, content]) => [
      relative,
      sha256(Buffer.from(content, 'utf8')),
    ]),
  );
  artifacts.manifest['output_hashes'] = outputHashes;
  const hashes = {
    contract: 'ltcm.p011.hashes.v1',
    algorithm: 'sha256',
    files: outputHashes,
  };
  files.set('manifest.json', prettyCanonicalJson(artifacts.manifest));
  files.set('hashes.json', prettyCanonicalJson(hashes));
  let movedExisting = false;
  try {
    await writeFile(path.join(temporary, MARKER_FILE), MARKER_CONTENT, {
      encoding: 'utf8',
      flag: 'wx',
    });
    for (const [relative, content] of files) {
      await writeFile(path.join(temporary, relative), content, { encoding: 'utf8', flag: 'wx' });
    }
    if (await exists(outputDir)) {
      await rename(outputDir, backup);
      movedExisting = true;
    }
    await rename(temporary, outputDir);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!(await exists(outputDir)) && movedExisting && (await exists(backup))) {
      await rename(backup, outputDir);
    }
    throw error;
  } finally {
    if (await exists(temporary)) await rm(temporary, { recursive: true, force: true });
    if (await exists(backup)) await rm(backup, { recursive: true, force: true });
  }
}
