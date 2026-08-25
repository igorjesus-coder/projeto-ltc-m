import { sha256Canonical } from './canonical-json.js';
import { canonicalizeP013MonthlyMoney } from './monthly-baseline.js';

export const P015_RECONCILIATION_CONTRACT = 'ltcm.p015.reconciliation.v1' as const;
export const P015_RECONCILIATION_REPORT_CONTRACT = 'ltcm.p015.reconciliation-report.v1' as const;

export const P015_FINDING_CODES = [
  'PROJECT_VALUE_MISMATCH',
  'ITEM_SUM_MISMATCH',
  'MISSING_PROJECT_VALUE',
  'DUPLICATE_PROJECT_SOURCE_IDENTITY',
  'DUPLICATE_ITEM_SOURCE_IDENTITY',
  'PLAN_TOTAL_MISMATCH',
  'MONTHLY_BASELINE_TOTAL_MISMATCH',
  'REALIZED_PROJECT_MISSING_COMPETENCE',
  'REALIZED_MONTH_MISSING_PROJECT',
  'ACTUAL_STATUS_UNRESOLVED',
  'MISSING_REQUIRED_FIELD',
  'SOURCE_DB_DIVERGENCE',
  'PENDING_BUSINESS_DECISION',
  'COST_RECONCILIATION_UNAVAILABLE',
  'GRAIN_MISMATCH',
  'UNSUPPORTED_COMPARISON',
  'IMPORT_DUPLICATION',
] as const;

export type P015FindingCode = (typeof P015_FINDING_CODES)[number];
export type P015Severity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
export type P015ProjectStatus = 'PASS' | 'WARNING' | 'ERROR' | 'BLOCKED_BY_DECISION';
export type P015Domain =
  | 'project_contract'
  | 'item_totals'
  | 'billing_planned'
  | 'billing_actual'
  | 'billing_remaining'
  | 'monthly_baseline'
  | 'project_costs'
  | 'duplicate_identity'
  | 'mandatory_fields'
  | 'provenance'
  | 'source_database'
  | 'import_idempotency'
  | 'grain_compatibility'
  | 'business_decision';

export interface P015Reference {
  kind: 'source' | 'database';
  locator: string;
  fingerprint: string;
}

export interface P015ProjectObservation {
  project_code: string;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  currency_code: string | null;
  contract_value: string | null;
  database_contract_value: string | null;
  source_references: P015Reference[];
  database_references: P015Reference[];
}

export interface P015ItemObservation {
  project_code: string;
  item_id: string | null;
  source_line_key: string;
  item_code: string | null;
  description: string | null;
  quantity: string | null;
  unit_code: string | null;
  currency_code: string | null;
  total_amount: string | null;
  database_total_amount: string | null;
  source_references: P015Reference[];
  database_references: P015Reference[];
}

export interface P015MonthlyObservation {
  project_code: string;
  source_line_key: string;
  competence_month: string;
  metric: 'billing_planned';
  currency_code: string;
  source_amount: string | null;
  database_amount: string | null;
  source_references: P015Reference[];
  database_references: P015Reference[];
}

export interface P015ActualEvidence {
  source_key: string;
  grain: 'project_aggregate' | 'portfolio_month';
  project_code: string | null;
  competence_month: string | null;
  metric: 'billing_actual';
  currency_code: string;
  amount: string;
  source_references: P015Reference[];
}

export interface P015CostObservation {
  project_code: string;
  currency_code: string;
  status: 'unavailable' | 'comparable';
  expected_value: string | null;
  observed_value: string | null;
  source_references: P015Reference[];
  database_references: P015Reference[];
}

export interface P015DecisionObservation {
  decision_reference: string;
  project_code: string | null;
  domain: P015Domain;
  finding_code: 'ACTUAL_STATUS_UNRESOLVED' | 'PENDING_BUSINESS_DECISION';
  explanation: string;
  blocking: boolean;
}

export interface P015UnsupportedComparison {
  project_code: string | null;
  domain: P015Domain;
  metric: string | null;
  currency_code: string | null;
  decision_reference: string | null;
  explanation: string;
  source_references: P015Reference[];
  database_references: P015Reference[];
}

export interface P015ReconciliationPayload {
  source_snapshot_fingerprint: string;
  database_snapshot_fingerprint: string | null;
  projects: P015ProjectObservation[];
  items: P015ItemObservation[];
  monthly_plan: P015MonthlyObservation[];
  actual_evidence: P015ActualEvidence[];
  costs: P015CostObservation[];
  decisions: P015DecisionObservation[];
  unsupported_comparisons: P015UnsupportedComparison[];
  import_identities: string[];
}

export interface P015ReconciliationInput extends P015ReconciliationPayload {
  contract: typeof P015_RECONCILIATION_CONTRACT;
  input_fingerprint: string;
}

export interface P015Finding {
  finding_id: string;
  finding_code: P015FindingCode;
  severity: P015Severity;
  domain: P015Domain;
  project_id: string | null;
  project_code: string | null;
  item_id: string | null;
  source_line_key: string | null;
  competence_date: string | null;
  metric: string | null;
  currency_code: string | null;
  expected_value: string | null;
  observed_value: string | null;
  delta: string | null;
  source_references: readonly P015Reference[];
  database_references: readonly P015Reference[];
  decision_reference: string | null;
  blocking: boolean;
  explanation: string;
  remediation_class:
    | 'correct_source'
    | 'correct_database'
    | 'supply_missing_evidence'
    | 'business_decision_required'
    | 'investigate_duplicate'
    | 'none';
}

export interface P015ReconciliationReport {
  contract: typeof P015_RECONCILIATION_REPORT_CONTRACT;
  reconciliation_contract: typeof P015_RECONCILIATION_CONTRACT;
  input_fingerprint: string;
  source_snapshot_fingerprint: string;
  database_snapshot_fingerprint: string | null;
  schema_classification: 'SCHEMA_COMPLETE';
  execution: {
    database_access: 'none';
    transaction_read_only: true;
    select_statement_count: 0;
    insert_count: 0;
    update_count: 0;
    delete_count: 0;
    ddl_count: 0;
  };
  severity_counts: Record<P015Severity, number>;
  domain_counts: Record<P015Domain, number>;
  project_summaries: Array<{
    project_code: string;
    status: P015ProjectStatus;
    finding_count: number;
    finding_codes: P015FindingCode[];
  }>;
  portfolio_summary: {
    project_count: number;
    pass_count: number;
    warning_count: number;
    error_count: number;
    blocked_by_decision_count: number;
    finding_count: number;
    p014_missing_grain_count: number;
    grain_compatible_delta_total: string;
  };
  unresolved_decisions: Array<{
    decision_reference: string;
    project_code: string | null;
    explanation: string;
    blocking: boolean;
  }>;
  non_migratable_evidence: Array<{
    source_key: string;
    finding_code: 'REALIZED_PROJECT_MISSING_COMPETENCE' | 'REALIZED_MONTH_MISSING_PROJECT';
    amount: string;
  }>;
  findings: readonly P015Finding[];
  arbitrary_allocation_performed: false;
  actual_events_manufactured: false;
  report_fingerprint: string;
}

const SHA256 = /^[0-9a-f]{64}$/u;
const PROJECT_CODE = /^[A-Z0-9][A-Z0-9._/-]{0,63}$/u;
const SOURCE_LINE_KEY = /^p012-line-v1:[0-9a-f]{64}$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])-01$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const SEVERITY_ORDER: Record<P015Severity, number> = {
  BLOCKING: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
};
const DOMAIN_VALUES: P015Domain[] = [
  'project_contract',
  'item_totals',
  'billing_planned',
  'billing_actual',
  'billing_remaining',
  'monthly_baseline',
  'project_costs',
  'duplicate_identity',
  'mandatory_fields',
  'provenance',
  'source_database',
  'import_idempotency',
  'grain_compatibility',
  'business_decision',
];

const issuedInputs = new WeakSet<object>();
const issuedReports = new WeakMap<object, string>();

function fail(reason: string): never {
  throw new Error(`P015_RECONCILIATION_INVALID:${reason}`);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [value]);
    else group.push(value);
  }
  return groups;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '' || value !== value.trim()) fail(label);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SHA256.test(result)) fail(label);
  return result;
}

function projectCode(value: unknown, label: string): string {
  const result = text(value, label);
  if (!PROJECT_CODE.test(result)) fail(label);
  return result;
}

function currency(value: unknown, label: string): string {
  const result = text(value, label);
  if (!CURRENCY.test(result)) fail(label);
  return result;
}

function money(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(label);
  try {
    return canonicalizeP013MonthlyMoney(value);
  } catch {
    fail(label);
  }
}

function nullableMoney(value: unknown, label: string): string | null {
  return value === null ? null : money(value, label);
}

function cents(value: string): bigint {
  const [integer, fraction] = value.split('.');
  return BigInt(integer!) * 100n + BigInt(fraction!);
}

function fromCents(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function reference(value: P015Reference, label: string): P015Reference {
  if (value === null || typeof value !== 'object') fail(label);
  if (value.kind !== 'source' && value.kind !== 'database') fail(`${label}.kind`);
  const locator = text(value.locator, `${label}.locator`);
  if (
    /(?:[A-Z]:\\|(?:^|\s)\/(?:home|Users)\/|postgres(?:ql)?:\/\/|https?:\/\/|\b(?:password|token|private_key|client_secret)\s*=)/iu.test(
      locator,
    )
  )
    fail(`${label}.locator-sensitive`);
  return {
    kind: value.kind,
    locator,
    fingerprint: sha(value.fingerprint, `${label}.fingerprint`),
  };
}

function references(values: P015Reference[], label: string): P015Reference[] {
  if (!Array.isArray(values) || values.length === 0) fail(label);
  return values
    .map((value, index) => reference(value, `${label}[${index}]`))
    .sort((left, right) =>
      compare(`${left.kind}\0${left.locator}`, `${right.kind}\0${right.locator}`),
    );
}

function optionalReferences(values: P015Reference[], label: string): P015Reference[] {
  if (!Array.isArray(values)) fail(label);
  return values
    .map((value, index) => reference(value, `${label}[${index}]`))
    .sort((left, right) =>
      compare(`${left.kind}\0${left.locator}`, `${right.kind}\0${right.locator}`),
    );
}

function finding(input: Omit<P015Finding, 'finding_id'>): P015Finding {
  const material = {
    contract: 'ltcm.p015.finding.v1',
    ...input,
    source_references: [...input.source_references],
    database_references: [...input.database_references],
  };
  return deepFreeze({
    ...input,
    finding_id: `p015-finding-v1:${sha256Canonical(material)}`,
  });
}

function findingSort(left: P015Finding, right: P015Finding): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    compare(left.domain, right.domain) ||
    compare(left.project_code ?? '', right.project_code ?? '') ||
    compare(
      left.source_line_key ?? left.item_id ?? '',
      right.source_line_key ?? right.item_id ?? '',
    ) ||
    compare(left.competence_date ?? '', right.competence_date ?? '') ||
    compare(left.finding_code, right.finding_code) ||
    compare(left.finding_id, right.finding_id)
  );
}

function baseFinding(options: {
  code: P015FindingCode;
  severity: P015Severity;
  domain: P015Domain;
  project: P015ProjectObservation | null;
  item?: P015ItemObservation | null;
  competence?: string | null;
  metric?: string | null;
  currencyCode?: string | null;
  expected?: string | null;
  observed?: string | null;
  delta?: string | null;
  sources?: readonly P015Reference[];
  database?: readonly P015Reference[];
  decision?: string | null;
  blocking?: boolean;
  explanation: string;
  remediation: P015Finding['remediation_class'];
}): P015Finding {
  return finding({
    finding_code: options.code,
    severity: options.severity,
    domain: options.domain,
    project_id: options.project?.project_id ?? null,
    project_code: options.project?.project_code ?? options.item?.project_code ?? null,
    item_id: options.item?.item_id ?? null,
    source_line_key: options.item?.source_line_key ?? null,
    competence_date: options.competence ?? null,
    metric: options.metric ?? null,
    currency_code: options.currencyCode ?? null,
    expected_value: options.expected ?? null,
    observed_value: options.observed ?? null,
    delta: options.delta ?? null,
    source_references: options.sources ?? [],
    database_references: options.database ?? [],
    decision_reference: options.decision ?? null,
    blocking: options.blocking ?? options.severity === 'BLOCKING',
    explanation: options.explanation,
    remediation_class: options.remediation,
  });
}

function canonicalPayload(payload: P015ReconciliationPayload): P015ReconciliationPayload {
  if (payload === null || typeof payload !== 'object') fail('payload');
  for (const [label, value] of [
    ['projects', payload.projects],
    ['items', payload.items],
    ['monthly-plan', payload.monthly_plan],
    ['actual-evidence', payload.actual_evidence],
    ['costs', payload.costs],
    ['decisions', payload.decisions],
    ['unsupported-comparisons', payload.unsupported_comparisons],
    ['import-identities', payload.import_identities],
  ] as const)
    if (!Array.isArray(value)) fail(label);
  const projects = payload.projects.map((entry, index) => {
    const code = projectCode(entry.project_code, `projects[${index}].project_code`);
    const currencyCode =
      entry.currency_code === null ? null : currency(entry.currency_code, 'project.currency');
    return {
      project_code: code,
      project_id: nullableText(entry.project_id, 'project.id'),
      project_name: nullableText(entry.project_name, 'project.name'),
      client_id: nullableText(entry.client_id, 'project.client'),
      currency_code: currencyCode,
      contract_value: nullableMoney(entry.contract_value, 'project.contract'),
      database_contract_value: nullableMoney(entry.database_contract_value, 'project.db-contract'),
      source_references: references(entry.source_references, 'project.source-references'),
      database_references: optionalReferences(
        entry.database_references,
        'project.database-references',
      ),
    };
  });
  const items = payload.items.map((entry, index) => {
    const key = text(entry.source_line_key, `items[${index}].source-line-key`);
    if (!SOURCE_LINE_KEY.test(key)) fail('item.source-line-key');
    return {
      project_code: projectCode(entry.project_code, 'item.project-code'),
      item_id: nullableText(entry.item_id, 'item.id'),
      source_line_key: key,
      item_code: nullableText(entry.item_code, 'item.item-code'),
      description: nullableText(entry.description, 'item.description'),
      quantity: nullableText(entry.quantity, 'item.quantity'),
      unit_code: nullableText(entry.unit_code, 'item.unit'),
      currency_code:
        entry.currency_code === null ? null : currency(entry.currency_code, 'item.currency'),
      total_amount: nullableMoney(entry.total_amount, 'item.total'),
      database_total_amount: nullableMoney(entry.database_total_amount, 'item.db-total'),
      source_references: references(entry.source_references, 'item.source-references'),
      database_references: optionalReferences(
        entry.database_references,
        'item.database-references',
      ),
    };
  });
  const knownProjects = new Set(projects.map(({ project_code }) => project_code));
  if (items.some((item) => !knownProjects.has(item.project_code))) fail('cross-project-item');
  const monthlyPlan = payload.monthly_plan.map((entry) => {
    const competence = text(entry.competence_month, 'monthly.competence');
    if (!MONTH.test(competence) || entry.metric !== 'billing_planned') fail('monthly.grain');
    if (!knownProjects.has(entry.project_code)) fail('cross-project-monthly');
    const sourceLineKey = text(entry.source_line_key, 'monthly.source-line-key');
    if (!SOURCE_LINE_KEY.test(sourceLineKey)) fail('monthly.source-line-key');
    return {
      project_code: projectCode(entry.project_code, 'monthly.project-code'),
      source_line_key: sourceLineKey,
      competence_month: competence,
      metric: 'billing_planned' as const,
      currency_code: currency(entry.currency_code, 'monthly.currency'),
      source_amount: nullableMoney(entry.source_amount, 'monthly.source-amount'),
      database_amount: nullableMoney(entry.database_amount, 'monthly.database-amount'),
      source_references: references(entry.source_references, 'monthly.source-references'),
      database_references: optionalReferences(
        entry.database_references,
        'monthly.database-references',
      ),
    };
  });
  const actualEvidence = payload.actual_evidence.map((entry) => {
    if (entry.grain !== 'project_aggregate' && entry.grain !== 'portfolio_month')
      fail('actual.grain');
    if (entry.metric !== 'billing_actual') fail('actual.metric');
    const project =
      entry.project_code === null ? null : projectCode(entry.project_code, 'actual.project');
    const competence = entry.competence_month;
    if (
      (entry.grain === 'project_aggregate' && (project === null || competence !== null)) ||
      (entry.grain === 'portfolio_month' &&
        (project !== null || competence === null || !MONTH.test(competence)))
    )
      fail('actual.grain');
    if (project !== null && !knownProjects.has(project)) fail('cross-project-actual');
    return {
      source_key: text(entry.source_key, 'actual.source-key'),
      grain: entry.grain,
      project_code: project,
      competence_month: competence,
      metric: 'billing_actual' as const,
      currency_code: currency(entry.currency_code, 'actual.currency'),
      amount: money(entry.amount, 'actual.amount'),
      source_references: references(entry.source_references, 'actual.source-references'),
    };
  });
  const costs = payload.costs.map((entry) => {
    if (entry.status !== 'unavailable' && entry.status !== 'comparable') fail('cost.status');
    const expected = nullableMoney(entry.expected_value, 'cost.expected');
    const observed = nullableMoney(entry.observed_value, 'cost.observed');
    if ((entry.status === 'comparable') !== (expected !== null && observed !== null))
      fail('cost.values');
    const code = projectCode(entry.project_code, 'cost.project');
    if (!knownProjects.has(code)) fail('cross-project-cost');
    return {
      project_code: code,
      currency_code: currency(entry.currency_code, 'cost.currency'),
      status: entry.status,
      expected_value: expected,
      observed_value: observed,
      source_references: references(entry.source_references, 'cost.source-references'),
      database_references: optionalReferences(
        entry.database_references,
        'cost.database-references',
      ),
    };
  });
  const decisions = payload.decisions.map((entry) => {
    if (!DOMAIN_VALUES.includes(entry.domain)) fail('decision.domain');
    if (
      entry.finding_code !== 'ACTUAL_STATUS_UNRESOLVED' &&
      entry.finding_code !== 'PENDING_BUSINESS_DECISION'
    )
      fail('decision.code');
    const code =
      entry.project_code === null ? null : projectCode(entry.project_code, 'decision.project');
    if (code !== null && !knownProjects.has(code)) fail('cross-project-decision');
    return {
      decision_reference: text(entry.decision_reference, 'decision.reference'),
      project_code: code,
      domain: entry.domain,
      finding_code: entry.finding_code,
      explanation: text(entry.explanation, 'decision.explanation'),
      blocking: entry.blocking === true,
    };
  });
  const unsupportedComparisons = payload.unsupported_comparisons.map((entry) => {
    if (!DOMAIN_VALUES.includes(entry.domain)) fail('unsupported.domain');
    const code =
      entry.project_code === null ? null : projectCode(entry.project_code, 'unsupported.project');
    if (code !== null && !knownProjects.has(code)) fail('cross-project-unsupported');
    return {
      project_code: code,
      domain: entry.domain,
      metric: nullableText(entry.metric, 'unsupported.metric'),
      currency_code:
        entry.currency_code === null ? null : currency(entry.currency_code, 'unsupported.currency'),
      decision_reference: nullableText(entry.decision_reference, 'unsupported.decision'),
      explanation: text(entry.explanation, 'unsupported.explanation'),
      source_references: optionalReferences(
        entry.source_references,
        'unsupported.source-references',
      ),
      database_references: optionalReferences(
        entry.database_references,
        'unsupported.database-references',
      ),
    };
  });
  return {
    source_snapshot_fingerprint: sha(payload.source_snapshot_fingerprint, 'source-fingerprint'),
    database_snapshot_fingerprint:
      payload.database_snapshot_fingerprint === null
        ? null
        : sha(payload.database_snapshot_fingerprint, 'database-fingerprint'),
    projects: projects.sort((a, b) =>
      compare(
        `${a.project_code}\0${a.project_id ?? ''}`,
        `${b.project_code}\0${b.project_id ?? ''}`,
      ),
    ),
    items: items.sort((a, b) =>
      compare(
        `${a.project_code}\0${a.source_line_key}\0${a.item_id ?? ''}`,
        `${b.project_code}\0${b.source_line_key}\0${b.item_id ?? ''}`,
      ),
    ),
    monthly_plan: monthlyPlan.sort((a, b) =>
      compare(
        `${a.project_code}\0${a.source_line_key}\0${a.competence_month}`,
        `${b.project_code}\0${b.source_line_key}\0${b.competence_month}`,
      ),
    ),
    actual_evidence: actualEvidence.sort((a, b) => compare(a.source_key, b.source_key)),
    costs: costs.sort((a, b) => compare(a.project_code, b.project_code)),
    decisions: decisions.sort((a, b) =>
      compare(
        `${a.project_code ?? ''}\0${a.decision_reference}`,
        `${b.project_code ?? ''}\0${b.decision_reference}`,
      ),
    ),
    unsupported_comparisons: unsupportedComparisons.sort((a, b) =>
      compare(
        `${a.project_code ?? ''}\0${a.domain}\0${a.metric ?? ''}`,
        `${b.project_code ?? ''}\0${b.domain}\0${b.metric ?? ''}`,
      ),
    ),
    import_identities: payload.import_identities
      .map((value) => text(value, 'import-identity'))
      .sort(compare),
  };
}

export function createP015ReconciliationInput(
  payload: P015ReconciliationPayload,
): P015ReconciliationInput {
  const canonical = canonicalPayload(payload);
  const material = { contract: P015_RECONCILIATION_CONTRACT, ...canonical };
  const result = deepFreeze({ ...material, input_fingerprint: sha256Canonical(material) });
  issuedInputs.add(result);
  return result;
}

function projectLookup(input: P015ReconciliationInput): Map<string, P015ProjectObservation> {
  const lookup = new Map<string, P015ProjectObservation>();
  for (const project of input.projects)
    if (!lookup.has(project.project_code)) lookup.set(project.project_code, project);
  return lookup;
}

function deriveFindings(input: P015ReconciliationInput): P015Finding[] {
  const findings: P015Finding[] = [];
  const projects = projectLookup(input);
  const projectGroups = groupBy(input.projects, ({ project_code }) => project_code);
  for (const [code, group] of projectGroups) {
    const project = group[0]!;
    if (group.length > 1)
      findings.push(
        baseFinding({
          code: 'DUPLICATE_PROJECT_SOURCE_IDENTITY',
          severity: 'ERROR',
          domain: 'duplicate_identity',
          project,
          sources: group.flatMap(({ source_references }) => source_references),
          explanation: `Multiple source project identities resolve to ${code}.`,
          remediation: 'investigate_duplicate',
        }),
      );
    for (const [field, value] of [
      ['project_name', project.project_name],
      ['client_id', project.client_id],
      ['currency_code', project.currency_code],
    ] as const) {
      if (value === null)
        findings.push(
          baseFinding({
            code: 'MISSING_REQUIRED_FIELD',
            severity: 'ERROR',
            domain: 'mandatory_fields',
            project,
            sources: project.source_references,
            explanation: `Required project field ${field} is missing.`,
            remediation: 'supply_missing_evidence',
          }),
        );
    }
    if (project.contract_value === null)
      findings.push(
        baseFinding({
          code: 'MISSING_PROJECT_VALUE',
          severity: 'BLOCKING',
          domain: 'project_contract',
          project,
          sources: project.source_references,
          explanation: 'Authoritative project contract value is missing.',
          remediation: 'business_decision_required',
        }),
      );
    if (
      project.contract_value !== null &&
      project.database_contract_value !== null &&
      project.contract_value !== project.database_contract_value
    )
      findings.push(
        baseFinding({
          code: 'SOURCE_DB_DIVERGENCE',
          severity: 'ERROR',
          domain: 'source_database',
          project,
          currencyCode: project.currency_code,
          expected: project.contract_value,
          observed: project.database_contract_value,
          delta: fromCents(cents(project.database_contract_value) - cents(project.contract_value)),
          sources: project.source_references,
          database: project.database_references,
          explanation: 'Database project value diverges from the authoritative source value.',
          remediation: 'correct_database',
        }),
      );
  }
  const itemGroups = groupBy(
    input.items,
    (item) => `${item.project_code}\0${item.source_line_key}`,
  );
  for (const group of itemGroups.values()) {
    const item = group[0]!;
    const project = projects.get(item.project_code)!;
    if (group.length > 1)
      findings.push(
        baseFinding({
          code: 'DUPLICATE_ITEM_SOURCE_IDENTITY',
          severity: 'ERROR',
          domain: 'duplicate_identity',
          project,
          item,
          sources: group.flatMap(({ source_references }) => source_references),
          explanation: 'Repeated project plus source_line_key identity.',
          remediation: 'investigate_duplicate',
        }),
      );
    for (const [field, value] of [
      ['description', item.description],
      ['quantity', item.quantity],
      ['unit_code', item.unit_code],
      ['currency_code', item.currency_code],
    ] as const) {
      if (value === null)
        findings.push(
          baseFinding({
            code: 'MISSING_REQUIRED_FIELD',
            severity: 'ERROR',
            domain: 'mandatory_fields',
            project,
            item,
            sources: item.source_references,
            explanation: `Required item field ${field} is missing.`,
            remediation: 'supply_missing_evidence',
          }),
        );
    }
    if (
      item.currency_code !== null &&
      project.currency_code !== null &&
      item.currency_code !== project.currency_code
    )
      findings.push(
        baseFinding({
          code: 'GRAIN_MISMATCH',
          severity: 'ERROR',
          domain: 'grain_compatibility',
          project,
          item,
          currencyCode: item.currency_code,
          sources: item.source_references,
          explanation: 'Item and project currencies are incompatible; values were not summed.',
          remediation: 'correct_source',
        }),
      );
    if (
      item.total_amount !== null &&
      item.database_total_amount !== null &&
      item.total_amount !== item.database_total_amount
    )
      findings.push(
        baseFinding({
          code: 'SOURCE_DB_DIVERGENCE',
          severity: 'ERROR',
          domain: 'source_database',
          project,
          item,
          currencyCode: item.currency_code,
          expected: item.total_amount,
          observed: item.database_total_amount,
          delta: fromCents(cents(item.database_total_amount) - cents(item.total_amount)),
          sources: item.source_references,
          database: item.database_references,
          explanation: 'Database item total diverges from the authoritative source value.',
          remediation: 'correct_database',
        }),
      );
  }
  for (const project of projects.values()) {
    const compatibleItems = input.items.filter(
      (item) =>
        item.project_code === project.project_code &&
        item.total_amount !== null &&
        item.currency_code === project.currency_code,
    );
    if (project.contract_value !== null && compatibleItems.length > 0) {
      const itemTotal = compatibleItems.reduce((sum, item) => sum + cents(item.total_amount!), 0n);
      const delta = itemTotal - cents(project.contract_value);
      if (delta !== 0n)
        findings.push(
          baseFinding({
            code: 'PROJECT_VALUE_MISMATCH',
            severity: 'ERROR',
            domain: 'item_totals',
            project,
            currencyCode: project.currency_code,
            expected: project.contract_value,
            observed: fromCents(itemTotal),
            delta: fromCents(delta),
            sources: [
              ...project.source_references,
              ...compatibleItems.flatMap(({ source_references }) => source_references),
            ],
            explanation: 'Sum of authoritative item totals differs from project contract value.',
            remediation: 'business_decision_required',
          }),
        );
    }
  }
  for (const group of groupBy(
    input.monthly_plan,
    (entry) => `${entry.project_code}\0${entry.source_line_key}`,
  ).values()) {
    const first = group[0]!;
    const project = projects.get(first.project_code)!;
    const sourceValues = group.filter(({ source_amount }) => source_amount !== null);
    const databaseValues = group.filter(({ database_amount }) => database_amount !== null);
    const sourceTotal = sourceValues.reduce((sum, entry) => sum + cents(entry.source_amount!), 0n);
    const databaseTotal = databaseValues.reduce(
      (sum, entry) => sum + cents(entry.database_amount!),
      0n,
    );
    for (const entry of group)
      if (
        entry.source_amount !== null &&
        entry.database_amount !== null &&
        entry.source_amount !== entry.database_amount
      )
        findings.push(
          baseFinding({
            code: 'SOURCE_DB_DIVERGENCE',
            severity: 'ERROR',
            domain: 'source_database',
            project,
            competence: entry.competence_month,
            metric: entry.metric,
            currencyCode: entry.currency_code,
            expected: entry.source_amount,
            observed: entry.database_amount,
            delta: fromCents(cents(entry.database_amount) - cents(entry.source_amount)),
            sources: entry.source_references,
            database: entry.database_references,
            explanation: 'Monthly database line diverges from its source cell.',
            remediation: 'correct_database',
          }),
        );
    if (sourceValues.length > 0 && databaseValues.length > 0 && sourceTotal !== databaseTotal)
      findings.push(
        baseFinding({
          code: 'MONTHLY_BASELINE_TOTAL_MISMATCH',
          severity: 'ERROR',
          domain: 'monthly_baseline',
          project,
          metric: 'billing_planned',
          currencyCode: first.currency_code,
          expected: fromCents(sourceTotal),
          observed: fromCents(databaseTotal),
          delta: fromCents(databaseTotal - sourceTotal),
          sources: group.flatMap(({ source_references }) => source_references),
          database: group.flatMap(({ database_references }) => database_references),
          explanation: 'Monthly baseline source total differs from the persisted plan-line total.',
          remediation: 'correct_database',
        }),
      );
  }
  for (const actual of input.actual_evidence) {
    const project =
      actual.project_code === null ? null : (projects.get(actual.project_code) ?? null);
    const code =
      actual.grain === 'project_aggregate'
        ? 'REALIZED_PROJECT_MISSING_COMPETENCE'
        : 'REALIZED_MONTH_MISSING_PROJECT';
    findings.push(
      baseFinding({
        code,
        severity: 'WARNING',
        domain: 'billing_actual',
        project,
        competence: actual.competence_month,
        metric: actual.metric,
        currencyCode: actual.currency_code,
        observed: actual.amount,
        sources: actual.source_references,
        explanation:
          actual.grain === 'project_aggregate'
            ? 'Project realized aggregate has no authoritative competence.'
            : 'Portfolio-month realized evidence has no authoritative project.',
        remediation: 'supply_missing_evidence',
      }),
    );
  }
  for (const cost of input.costs) {
    const project = projects.get(cost.project_code)!;
    if (cost.status === 'unavailable')
      findings.push(
        baseFinding({
          code: 'COST_RECONCILIATION_UNAVAILABLE',
          severity: 'INFO',
          domain: 'project_costs',
          project,
          currencyCode: cost.currency_code,
          sources: cost.source_references,
          database: cost.database_references,
          explanation: 'Source semantics do not support a cost comparison.',
          remediation: 'supply_missing_evidence',
        }),
      );
    else if (cost.expected_value !== cost.observed_value)
      findings.push(
        baseFinding({
          code: 'SOURCE_DB_DIVERGENCE',
          severity: 'ERROR',
          domain: 'project_costs',
          project,
          currencyCode: cost.currency_code,
          expected: cost.expected_value,
          observed: cost.observed_value,
          delta: fromCents(cents(cost.observed_value!) - cents(cost.expected_value!)),
          sources: cost.source_references,
          database: cost.database_references,
          explanation: 'Comparable project cost diverges.',
          remediation: 'correct_database',
        }),
      );
  }
  for (const decision of input.decisions)
    findings.push(
      baseFinding({
        code: decision.finding_code,
        severity: decision.blocking ? 'BLOCKING' : 'WARNING',
        domain: decision.domain,
        project:
          decision.project_code === null ? null : (projects.get(decision.project_code) ?? null),
        decision: decision.decision_reference,
        blocking: decision.blocking,
        explanation: decision.explanation,
        remediation: 'business_decision_required',
      }),
    );
  for (const unsupported of input.unsupported_comparisons)
    findings.push(
      baseFinding({
        code: 'UNSUPPORTED_COMPARISON',
        severity: 'INFO',
        domain: unsupported.domain,
        project:
          unsupported.project_code === null
            ? null
            : (projects.get(unsupported.project_code) ?? null),
        metric: unsupported.metric,
        currencyCode: unsupported.currency_code,
        sources: unsupported.source_references,
        database: unsupported.database_references,
        decision: unsupported.decision_reference,
        explanation: unsupported.explanation,
        remediation:
          unsupported.decision_reference === null
            ? 'supply_missing_evidence'
            : 'business_decision_required',
      }),
    );
  for (const group of groupBy(input.import_identities, (identity) => identity).values())
    if (group.length > 1)
      findings.push(
        baseFinding({
          code: 'IMPORT_DUPLICATION',
          severity: 'ERROR',
          domain: 'import_idempotency',
          project: null,
          explanation: `Import identity ${group[0]} occurs more than once.`,
          remediation: 'investigate_duplicate',
        }),
      );
  return findings.sort(findingSort);
}

export function generateP015ReconciliationReport(
  input: P015ReconciliationInput,
): P015ReconciliationReport {
  if (!issuedInputs.has(input)) fail('untrusted-input');
  if (
    sha256Canonical({ contract: input.contract, ...canonicalPayload(input) }) !==
    input.input_fingerprint
  )
    fail('input-fingerprint');
  const findings = deriveFindings(input);
  if (new Set(findings.map(({ finding_id }) => finding_id)).size !== findings.length)
    fail('duplicate-finding');
  const severityCounts = Object.fromEntries(
    ['INFO', 'WARNING', 'ERROR', 'BLOCKING'].map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  ) as Record<P015Severity, number>;
  const domainCounts = Object.fromEntries(
    DOMAIN_VALUES.map((domain) => [
      domain,
      findings.filter((finding) => finding.domain === domain).length,
    ]),
  ) as Record<P015Domain, number>;
  const projectCodes = [...new Set(input.projects.map(({ project_code }) => project_code))].sort(
    compare,
  );
  const projectSummaries = projectCodes.map((code) => {
    const scoped = findings.filter(({ project_code }) => project_code === code);
    const status: P015ProjectStatus = scoped.some(
      ({ severity, blocking }) => severity === 'BLOCKING' || blocking,
    )
      ? 'BLOCKED_BY_DECISION'
      : scoped.some(({ severity }) => severity === 'ERROR')
        ? 'ERROR'
        : scoped.some(({ severity }) => severity === 'WARNING')
          ? 'WARNING'
          : 'PASS';
    return {
      project_code: code,
      status,
      finding_count: scoped.length,
      finding_codes: [...new Set(scoped.map(({ finding_code }) => finding_code))].sort(compare),
    };
  });
  const grainCompatibleDelta = findings
    .filter((finding) => finding.delta !== null && finding.finding_code !== 'GRAIN_MISMATCH')
    .reduce(
      (sum, finding) =>
        sum + cents(finding.delta!.replace('-', '')) * (finding.delta!.startsWith('-') ? -1n : 1n),
      0n,
    );
  const material = {
    contract: P015_RECONCILIATION_REPORT_CONTRACT,
    reconciliation_contract: P015_RECONCILIATION_CONTRACT,
    input_fingerprint: input.input_fingerprint,
    source_snapshot_fingerprint: input.source_snapshot_fingerprint,
    database_snapshot_fingerprint: input.database_snapshot_fingerprint,
    schema_classification: 'SCHEMA_COMPLETE' as const,
    execution: {
      database_access: 'none' as const,
      transaction_read_only: true as const,
      select_statement_count: 0 as const,
      insert_count: 0 as const,
      update_count: 0 as const,
      delete_count: 0 as const,
      ddl_count: 0 as const,
    },
    severity_counts: severityCounts,
    domain_counts: domainCounts,
    project_summaries: projectSummaries,
    portfolio_summary: {
      project_count: projectSummaries.length,
      pass_count: projectSummaries.filter(({ status }) => status === 'PASS').length,
      warning_count: projectSummaries.filter(({ status }) => status === 'WARNING').length,
      error_count: projectSummaries.filter(({ status }) => status === 'ERROR').length,
      blocked_by_decision_count: projectSummaries.filter(
        ({ status }) => status === 'BLOCKED_BY_DECISION',
      ).length,
      finding_count: findings.length,
      p014_missing_grain_count: findings.filter(
        ({ finding_code }) =>
          finding_code === 'REALIZED_PROJECT_MISSING_COMPETENCE' ||
          finding_code === 'REALIZED_MONTH_MISSING_PROJECT',
      ).length,
      grain_compatible_delta_total: fromCents(grainCompatibleDelta),
    },
    unresolved_decisions: input.decisions.map(
      ({ decision_reference, project_code, explanation, blocking }) => ({
        decision_reference,
        project_code,
        explanation,
        blocking,
      }),
    ),
    non_migratable_evidence: input.actual_evidence.map((actual) => ({
      source_key: actual.source_key,
      finding_code:
        actual.grain === 'project_aggregate'
          ? ('REALIZED_PROJECT_MISSING_COMPETENCE' as const)
          : ('REALIZED_MONTH_MISSING_PROJECT' as const),
      amount: actual.amount,
    })),
    findings,
    arbitrary_allocation_performed: false as const,
    actual_events_manufactured: false as const,
  };
  const report = deepFreeze({ ...material, report_fingerprint: sha256Canonical(material) });
  issuedReports.set(report, report.report_fingerprint);
  return report;
}

export function assertP015ReconciliationReport(report: P015ReconciliationReport): void {
  if (issuedReports.get(report) !== report.report_fingerprint) fail('untrusted-report');
  const { report_fingerprint: fingerprint, ...material } = report;
  if (sha256Canonical(material) !== fingerprint) fail('report-fingerprint');
}

export function renderP015HumanSummary(report: P015ReconciliationReport): string {
  assertP015ReconciliationReport(report);
  const lines = [
    `P015 reconciliation ${report.report_fingerprint}`,
    `Projects: ${report.portfolio_summary.project_count}; findings: ${report.portfolio_summary.finding_count}`,
    ...report.findings.map((finding) =>
      [
        finding.project_code ?? 'PORTFOLIO',
        finding.domain,
        finding.finding_code,
        finding.expected_value ?? '-',
        finding.observed_value ?? '-',
        finding.delta ?? '-',
        finding.severity,
        finding.source_references.map(({ locator }) => locator).join(','),
        finding.remediation_class,
      ].join(' | '),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
