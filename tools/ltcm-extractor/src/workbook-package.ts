import * as XLSX from 'xlsx';

export interface WorksheetPackageMetadata {
  worksheetRange: string | null;
  formulaCells: number;
  formulaDefinitions: number;
}

function entryText(container: unknown, target: string): string {
  const entry = XLSX.CFB.find(container, target) as { content?: Uint8Array } | null;
  if (entry?.content === undefined) throw new Error(`Entrada XLSX ausente: ${target}.`);
  return Buffer.from(entry.content)
    .toString('utf8')
    .replace(/^\uFEFF/u, '');
}

function attributes(tag: string): Map<string, string> {
  return new Map(
    [...tag.matchAll(/([\w:]+)="([^"]*)"/gu)].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
}

function rangeFromReferences(xml: string): string | null {
  const references = [
    ...[...xml.matchAll(/<(?:\w+:)?c\b[^>]*\br="([A-Z]+[0-9]+)"/gu)].map((match) => match[1] ?? ''),
    ...[...xml.matchAll(/<(?:\w+:)?mergeCell\b[^>]*\bref="([A-Z]+[0-9]+:[A-Z]+[0-9]+)"/gu)].flatMap(
      (match) => (match[1] ?? '').split(':'),
    ),
  ].filter((reference) => reference !== '');
  if (references.length === 0) return null;
  const decoded = references.map((reference) => XLSX.utils.decode_cell(reference));
  return XLSX.utils.encode_range({
    s: {
      r: Math.min(...decoded.map((cell) => cell.r)),
      c: Math.min(...decoded.map((cell) => cell.c)),
    },
    e: {
      r: Math.max(...decoded.map((cell) => cell.r)),
      c: Math.max(...decoded.map((cell) => cell.c)),
    },
  });
}

export function inspectWorkbookPackage(inputBytes: Buffer): Map<string, WorksheetPackageMetadata> {
  const container: unknown = XLSX.CFB.read(inputBytes, { type: 'buffer' });
  const workbookXml = entryText(container, '/xl/workbook.xml');
  const relationshipsXml = entryText(container, '/xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/gu)) {
    const values = attributes(match[0]);
    const id = values.get('Id');
    const target = values.get('Target');
    if (id !== undefined && target?.includes('worksheets/') === true) targets.set(id, target);
  }

  const result = new Map<string, WorksheetPackageMetadata>();
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/gu)) {
    const values = attributes(match[0]);
    const name = values.get('name');
    const relationshipId = values.get('r:id');
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId);
    if (name === undefined || target === undefined) continue;
    const xml = entryText(container, target.startsWith('/') ? target : `/xl/${target}`);
    const formulaTags = [...xml.matchAll(/<(?:\w+:)?f\b([^>]*)>/gu)];
    const sharedFollowers = formulaTags.filter((formula) => {
      const values = attributes(formula[0]);
      return values.get('t') === 'shared' && !values.has('ref');
    }).length;
    result.set(name, {
      worksheetRange: rangeFromReferences(xml),
      formulaCells: formulaTags.length,
      formulaDefinitions: formulaTags.length - sharedFollowers,
    });
  }
  return result;
}
