import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { sha256Bytes } from './canonical-json.js';
import { extractWorkbook } from './extractor.js';
import {
  assertP014RealizedSourceFingerprint,
  evaluateP014RealizedSource,
  type P014DocumentaryRealizedEvidence,
  type P014RealizedSourcePosition,
} from './p014-source-gate.js';
import { inspectWorkbookPackage } from './workbook-package.js';

export type {
  P014RealizedAuthoritativeGrain,
  P014RealizedDeclarationState,
  P014RealizedSourcePosition,
} from './p014-source-gate.js';

export const P014_CERTIFIED_REALIZED_SOURCE_CONTRACT =
  'ltcm.p014.certified-realized-source.v1' as const;

export interface P014CertifiedRealizedSource {
  contract: typeof P014_CERTIFIED_REALIZED_SOURCE_CONTRACT;
  source_name: string;
  source_sha256: string;
  source_size_bytes: number;
  source_semantic_fingerprint: string;
  worksheet_names: readonly [
    'Valores Projetos LTC-M',
    'Prev. Receita Mensal',
    'Curva S',
    'Decisões Aprovadas',
  ];
  position_count: 18;
  fact_count: 10;
  blank_count: 8;
  explicit_zero_count: 6;
  non_zero_count: 4;
  project_aggregate_total: string;
  portfolio_month_total: string;
}

export interface P014CertifiedRealizedFacts {
  readonly public_identity: P014CertifiedRealizedSource;
  readonly positions: readonly P014RealizedSourcePosition[];
}

const certifiedSources = new WeakMap<object, P014CertifiedRealizedFacts>();

class P014SourceBoundaryError extends Error {}

function sourceError(code: string): never {
  throw new P014SourceBoundaryError(code);
}

function cellText(sheet: XLSX.WorkSheet, address: string): string | null {
  const value = sheet[address]?.v;
  return typeof value === 'string' ? value : null;
}

function readP014DocumentaryRealizedEvidence(bytes: Buffer): P014DocumentaryRealizedEvidence {
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    sheets: ['Decisões Aprovadas'],
    cellFormula: true,
    cellText: true,
    cellDates: false,
  });
  const sheet = workbook.Sheets['Decisões Aprovadas'];
  if (sheet === undefined) sourceError('P014_SOURCE_DOCUMENTARY_SHEET_MISSING');
  const structuralRange = inspectWorkbookPackage(bytes).get('Decisões Aprovadas')?.worksheetRange;
  return Object.freeze({
    worksheet_name: 'Decisões Aprovadas',
    structural_range: structuralRange ?? null,
    realized_topic: cellText(sheet, 'B5'),
    realized_meaning: cellText(sheet, 'C5'),
    realized_workbook_effect: cellText(sheet, 'D5'),
    realized_system_effect: cellText(sheet, 'E5'),
    realized_status: cellText(sheet, 'F5'),
    closed_project_topic: cellText(sheet, 'B9'),
    closed_project_meaning: cellText(sheet, 'C9'),
    closed_project_system_effect: cellText(sheet, 'E9'),
  });
}

function immutableFacts(
  publicIdentity: P014CertifiedRealizedSource,
  positions: readonly P014RealizedSourcePosition[],
): P014CertifiedRealizedFacts {
  return Object.freeze({
    public_identity: Object.freeze({ ...publicIdentity }),
    positions: Object.freeze(positions.map((candidate) => Object.freeze({ ...candidate }))),
  });
}

function sanitizedSourceError(error: unknown): never {
  if (error instanceof P014SourceBoundaryError) throw error;
  if (error instanceof Error && error.message.startsWith('P014_')) {
    throw new P014SourceBoundaryError(error.message);
  }
  throw new P014SourceBoundaryError('P014_SOURCE_READ_FAILED');
}

export async function loadP014CertifiedRealizedSource(
  inputPath: string,
): Promise<P014CertifiedRealizedSource> {
  try {
    const resolved = path.resolve(inputPath);
    const before = await stat(resolved);
    if (!before.isFile()) sourceError('P014_SOURCE_NOT_REGULAR_FILE');
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
      sourceError('P014_SOURCE_CHANGED_DURING_READ');
    }
    if (extraction.exitCode !== 0) sourceError('P014_SOURCE_P010_GATE_FAILED');
    const metadata = inspectWorkbookPackage(bytes);
    const gate = assertP014RealizedSourceFingerprint(
      evaluateP014RealizedSource({
        project_rows: extraction.rowsBySheet.get('project_values') ?? [],
        monthly_rows: extraction.rowsBySheet.get('monthly_revenue') ?? [],
        curve_rows: extraction.rowsBySheet.get('curve_s') ?? [],
        package_metadata: metadata,
        documentary: readP014DocumentaryRealizedEvidence(bytes),
      }),
    );
    if (
      gate.semantic_fingerprint === null ||
      gate.project_aggregate_total === null ||
      gate.portfolio_month_total === null ||
      gate.position_count !== 18 ||
      gate.fact_count !== 10 ||
      gate.blank_count !== 8 ||
      gate.explicit_zero_count !== 6 ||
      gate.non_zero_count !== 4
    ) {
      sourceError('P014_SOURCE_CERTIFICATION_FAILED');
    }
    const identity: P014CertifiedRealizedSource = Object.freeze({
      contract: P014_CERTIFIED_REALIZED_SOURCE_CONTRACT,
      source_name: path.basename(resolved),
      source_sha256: sourceSha256,
      source_size_bytes: bytes.byteLength,
      source_semantic_fingerprint: gate.semantic_fingerprint,
      worksheet_names: Object.freeze([
        'Valores Projetos LTC-M',
        'Prev. Receita Mensal',
        'Curva S',
        'Decisões Aprovadas',
      ]) as P014CertifiedRealizedSource['worksheet_names'],
      position_count: 18,
      fact_count: 10,
      blank_count: 8,
      explicit_zero_count: 6,
      non_zero_count: 4,
      project_aggregate_total: gate.project_aggregate_total,
      portfolio_month_total: gate.portfolio_month_total,
    });
    certifiedSources.set(identity, immutableFacts(identity, gate.positions));
    return identity;
  } catch (error) {
    sanitizedSourceError(error);
  }
}

export function readP014CertifiedRealizedSourceFacts(
  source: P014CertifiedRealizedSource,
): P014CertifiedRealizedFacts {
  const facts = certifiedSources.get(source);
  if (facts === undefined) sourceError('P014_SOURCE_AUTHORITY_REQUIRED');
  return immutableFacts(facts.public_identity, facts.positions);
}
