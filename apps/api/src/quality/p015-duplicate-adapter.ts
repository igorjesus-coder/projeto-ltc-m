import { createHash } from 'node:crypto';

export interface P034ProvenanceReference {
  readonly kind: 'source' | 'database';
  readonly locator: string;
  readonly fingerprint: string;
}

export interface P034ProjectObservation {
  readonly project_code: string;
  readonly project_id: string;
  readonly source_references: readonly P034ProvenanceReference[];
}

export interface P034ItemObservation {
  readonly project_code: string;
  readonly source_line_key: string;
  readonly item_id: string | null;
  readonly source_references: readonly P034ProvenanceReference[];
}

export interface P034DuplicatePayload {
  readonly project_observations: readonly P034ProjectObservation[];
  readonly item_observations: readonly P034ItemObservation[];
}

export interface P034DuplicateFinding {
  readonly finding_id: string;
  readonly finding_code: 'DUPLICATE_PROJECT_SOURCE_IDENTITY' | 'DUPLICATE_ITEM_SOURCE_IDENTITY';
  readonly project_id: string;
  readonly project_code: string;
  readonly item_id: string | null;
  readonly source_line_key: string | null;
  readonly source_references: readonly P034ProvenanceReference[];
  readonly explanation: string;
  readonly remediation_class: 'investigate_duplicate';
  readonly severity: 'ERROR';
  readonly domain: 'duplicate_identity';
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('P034_CANONICAL_NUMBER_INVALID');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  throw new TypeError('P034_CANONICAL_VALUE_INVALID');
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function referenceSort(left: P034ProvenanceReference, right: P034ProvenanceReference): number {
  return compare(`${left.kind}\0${left.locator}`, `${right.kind}\0${right.locator}`);
}

function sourceReferences(
  values: readonly P034ProvenanceReference[],
): readonly P034ProvenanceReference[] {
  const references = values.filter((value) => value.kind === 'source').sort(referenceSort);
  if (references.length === 0) throw new Error('P034_PROVENANCE_SOURCE_REFERENCE_INVALID');
  return references;
}

function findingId(input: Omit<P034DuplicateFinding, 'finding_id'>): string {
  return `p015-finding-v1:${sha256Canonical({
    contract: 'ltcm.p015.finding.v1',
    finding_code: input.finding_code,
    severity: input.severity,
    domain: input.domain,
    project_id: input.project_id,
    project_code: input.project_code,
    item_id: input.item_id,
    source_line_key: input.source_line_key,
    competence_date: null,
    metric: null,
    currency_code: null,
    expected_value: null,
    observed_value: null,
    delta: null,
    source_references: [...input.source_references],
    database_references: [],
    decision_reference: null,
    blocking: false,
    explanation: input.explanation,
    remediation_class: input.remediation_class,
  })}`;
}

function projectFinding(group: readonly P034ProjectObservation[]): P034DuplicateFinding {
  const base = group[0];
  if (!base) throw new Error('P034_PROVENANCE_PROJECT_GROUP_INVALID');
  const input: Omit<P034DuplicateFinding, 'finding_id'> = {
    finding_code: 'DUPLICATE_PROJECT_SOURCE_IDENTITY',
    severity: 'ERROR',
    domain: 'duplicate_identity',
    project_id: base.project_id,
    project_code: base.project_code,
    item_id: null,
    source_line_key: null,
    source_references: group.flatMap((observation) =>
      sourceReferences(observation.source_references),
    ),
    explanation: `Multiple source project identities resolve to ${base.project_code}.`,
    remediation_class: 'investigate_duplicate',
  };
  return { ...input, finding_id: findingId(input) };
}

function itemFinding(
  group: readonly P034ItemObservation[],
  projects: readonly P034ProjectObservation[],
): P034DuplicateFinding {
  const base = group[0];
  if (!base) throw new Error('P034_PROVENANCE_ITEM_GROUP_INVALID');
  const project = projects.find(({ project_code }) => project_code === base.project_code);
  if (!project) throw new Error('P034_PROVENANCE_PROJECT_BINDING_INVALID');
  const input: Omit<P034DuplicateFinding, 'finding_id'> = {
    finding_code: 'DUPLICATE_ITEM_SOURCE_IDENTITY',
    severity: 'ERROR',
    domain: 'duplicate_identity',
    project_id: project.project_id,
    project_code: base.project_code,
    item_id: base.item_id,
    source_line_key: base.source_line_key,
    source_references: group.flatMap((observation) =>
      sourceReferences(observation.source_references),
    ),
    explanation: 'Repeated project plus source_line_key identity.',
    remediation_class: 'investigate_duplicate',
  };
  return { ...input, finding_id: findingId(input) };
}

export function deriveP034DuplicateFindings(
  payload: P034DuplicatePayload,
): readonly P034DuplicateFinding[] {
  const projects = [...payload.project_observations].sort((left, right) =>
    compare(
      `${left.project_code}\0${left.project_id}`,
      `${right.project_code}\0${right.project_id}`,
    ),
  );
  const items = [...payload.item_observations].sort((left, right) =>
    compare(
      `${left.project_code}\0${left.source_line_key}\0${left.item_id ?? ''}`,
      `${right.project_code}\0${right.source_line_key}\0${right.item_id ?? ''}`,
    ),
  );
  const projectGroups = new Map<string, P034ProjectObservation[]>();
  for (const observation of projects) {
    const group = projectGroups.get(observation.project_code) ?? [];
    group.push(observation);
    projectGroups.set(observation.project_code, group);
  }
  const itemGroups = new Map<string, P034ItemObservation[]>();
  for (const observation of items) {
    const key = `${observation.project_code}\0${observation.source_line_key}`;
    const group = itemGroups.get(key) ?? [];
    group.push(observation);
    itemGroups.set(key, group);
  }
  return [
    ...[...projectGroups.values()].filter((group) => group.length > 1).map(projectFinding),
    ...[...itemGroups.values()]
      .filter((group) => group.length > 1)
      .map((group) => itemFinding(group, projects)),
  ];
}
