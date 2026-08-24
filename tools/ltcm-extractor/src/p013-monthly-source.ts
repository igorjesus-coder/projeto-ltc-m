import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { sha256Bytes } from './canonical-json.js';
import { extractWorkbook } from './extractor.js';
import {
  assertP013MonthlySourceFingerprint,
  evaluateP013MonthlySource,
  materializeP013MonthlySourceCellFacts,
  type P013MonthlySourceCellFacts,
} from './p013-source-gate.js';
import { inspectWorkbookPackage } from './workbook-package.js';

export type { P013MonthlySourceCellFacts } from './p013-source-gate.js';

export const P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT =
  'ltcm.p013.certified-monthly-source.v1' as const;

export interface P013CertifiedMonthlySource {
  contract: typeof P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT;
  source_name: string;
  source_sha256: string;
  source_size_bytes: number;
  source_semantic_fingerprint: string;
  worksheet_key: 'monthly_revenue';
  worksheet_name: 'Prev. Receita Mensal';
  structural_range: 'A1:T52';
  cell_count: 432;
  blank_count: number;
  explicit_zero_count: number;
  non_zero_count: number;
  canonical_total: string;
  aggregate_raw_rounded_total: string;
  rounding_residual: string;
}

interface CertifiedFacts {
  readonly publicIdentity: P013CertifiedMonthlySource;
  readonly cells: readonly P013MonthlySourceCellFacts[];
}

const certifiedSources = new WeakMap<object, CertifiedFacts>();

class P013SourceBoundaryError extends Error {}

function sourceError(code: string): never {
  throw new P013SourceBoundaryError(code);
}

function immutableIdentity(value: P013CertifiedMonthlySource): P013CertifiedMonthlySource {
  return Object.freeze({ ...value });
}

function immutableFacts(
  publicIdentity: P013CertifiedMonthlySource,
  cells: readonly P013MonthlySourceCellFacts[],
): CertifiedFacts {
  return Object.freeze({
    publicIdentity,
    cells: Object.freeze(cells.map((cell) => Object.freeze({ ...cell }))),
  });
}

function sanitizedSourceError(error: unknown): never {
  if (error instanceof P013SourceBoundaryError) throw error;
  throw new Error('P013_SOURCE_READ_FAILED');
}

export async function loadP013CertifiedMonthlySource(
  inputPath: string,
): Promise<P013CertifiedMonthlySource> {
  try {
    const resolved = path.resolve(inputPath);
    const before = await stat(resolved);
    if (!before.isFile()) sourceError('P013_SOURCE_NOT_REGULAR_FILE');
    const extraction = await extractWorkbook({
      inputPath: resolved,
      outputDir: path.dirname(resolved),
      strict: true,
    });
    const bytes = await readFile(resolved);
    const after = await stat(resolved);
    const sourceSha256 = sha256Bytes(bytes);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== extraction.manifest.source.byte_size ||
      sourceSha256 !== extraction.manifest.source.source_hash
    ) {
      sourceError('P013_SOURCE_CHANGED_DURING_READ');
    }
    const rows = extraction.rowsBySheet.get('monthly_revenue') ?? [];
    const packageMetadata = inspectWorkbookPackage(bytes).get('Prev. Receita Mensal');
    const gate = assertP013MonthlySourceFingerprint(
      evaluateP013MonthlySource(rows, packageMetadata),
    );
    if (
      extraction.exitCode !== 0 ||
      gate.cell_count !== 432 ||
      gate.semantic_fingerprint === null ||
      gate.canonical_total === null ||
      gate.aggregate_raw_rounded_total === null ||
      gate.rounding_residual === null
    ) {
      sourceError('P013_SOURCE_CERTIFICATION_FAILED');
    }
    const cells = materializeP013MonthlySourceCellFacts(rows, packageMetadata);
    const identity = immutableIdentity({
      contract: P013_CERTIFIED_MONTHLY_SOURCE_CONTRACT,
      source_name: path.basename(resolved),
      source_sha256: sourceSha256,
      source_size_bytes: bytes.byteLength,
      source_semantic_fingerprint: gate.semantic_fingerprint,
      worksheet_key: 'monthly_revenue',
      worksheet_name: 'Prev. Receita Mensal',
      structural_range: 'A1:T52',
      cell_count: 432,
      blank_count: gate.blank_count,
      explicit_zero_count: gate.explicit_zero_count,
      non_zero_count: gate.non_zero_count,
      canonical_total: gate.canonical_total,
      aggregate_raw_rounded_total: gate.aggregate_raw_rounded_total,
      rounding_residual: gate.rounding_residual,
    });
    certifiedSources.set(identity, immutableFacts(identity, cells));
    return identity;
  } catch (error) {
    sanitizedSourceError(error);
  }
}

export function readP013CertifiedMonthlySourceFacts(
  source: P013CertifiedMonthlySource,
): CertifiedFacts {
  const facts = certifiedSources.get(source);
  if (facts === undefined) sourceError('P013_SOURCE_AUTHORITY_REQUIRED');
  return immutableFacts(facts.publicIdentity, facts.cells);
}
