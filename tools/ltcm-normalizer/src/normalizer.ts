import { sha256Canonical } from './canonical-json.js';
import { canonicalInputHash, type LoadedSource } from './source-reader.js';
import {
  EXPECTED_PROJECT_CODES,
  NORMALIZER_VERSION,
  type ClientCandidate,
  type Diagnostic,
  type ExistingSnapshot,
  type FinancialEvidence,
  type ImportPlanOperation,
  type MappingEvidence,
  type MappingStatus,
  type P010Row,
  type P011Artifacts,
  type ProjectCandidate,
  type RawCell,
  type SourceCoordinate,
} from './types.js';

const PROJECT_CODE = /^\d{4}-\d{2}-\d{5}$/u;
const PROJECT_PREFIX = /^\s*(\d{4}-\d{2}-\d{5})/u;
const CLASSIFICATION_SUFFIX = /\s+\((demanda|saldo|contrato)\)\s*$/iu;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeClientName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function clientMatchKey(value: string): string {
  return normalizeClientName(value).toLocaleLowerCase('und');
}

function cell(row: P010Row, column: string): RawCell | undefined {
  return row.raw_payload.cells.find((candidate) => candidate.column_letter === column);
}

function rowAt(rows: P010Row[], number: number): P010Row {
  const row = rows.find((candidate) => candidate.source_row_number === number);
  if (row === undefined) throw new Error(`Linha P010 obrigatória ausente: ${number}.`);
  return row;
}

function coordinate(source: LoadedSource, row: P010Row, address: string): SourceCoordinate {
  return {
    sheet_key: row.raw_payload.sheet_key,
    sheet_name: row.raw_payload.sheet_name,
    source_row_number: row.source_row_number,
    source_range: row.source_range,
    cell_address: address,
    row_hash: row.row_hash,
    workbook_hash: source.workbookHash,
  };
}

function originSort(left: SourceCoordinate, right: SourceCoordinate): number {
  return (
    compare(left.sheet_key, right.sheet_key) ||
    left.source_row_number - right.source_row_number ||
    compare(left.cell_address, right.cell_address)
  );
}

function uniqueOrigins(origins: SourceCoordinate[]): SourceCoordinate[] {
  return [...new Map(origins.map((origin) => [sha256Canonical(origin), origin])).values()].sort(
    originSort,
  );
}

function diagnostic(
  code: string,
  severity: 'warning' | 'error',
  entity: Diagnostic['entity'],
  entityKey: string | null,
  message: string,
  decisionRequired: string | null,
  origin: SourceCoordinate | null,
): Diagnostic {
  const payload = {
    code,
    severity,
    entity,
    entity_key: entityKey,
    message,
    decision_required: decisionRequired,
    origin,
  };
  return { ...payload, hash: sha256Canonical(payload) };
}

function mapping(
  entity: MappingEvidence['entity'],
  entityKey: string,
  sourceField: string,
  sourceHeader: string,
  rawValue: string | number | boolean | null,
  normalizedValue: string | null,
  targetField: string | null,
  status: MappingStatus,
  reason: string,
  origin: SourceCoordinate,
): MappingEvidence {
  const payload = {
    entity,
    entity_key: entityKey,
    source_field: sourceField,
    source_header: sourceHeader,
    source_coordinate: `${origin.sheet_key}!${origin.cell_address}`,
    raw_value: rawValue,
    normalized_value: normalizedValue,
    target_field: targetField,
    mapping_status: status,
    mapping_reason: reason,
    origin,
  };
  return { ...payload, hash: sha256Canonical(payload) };
}

function splitClientAndClassification(rawValue: string): {
  clientName: string;
  classification: string | null;
} {
  const suffix = rawValue.match(CLASSIFICATION_SUFFIX);
  if (suffix === null) return { clientName: rawValue, classification: null };
  return {
    clientName: rawValue.slice(0, suffix.index).trimEnd(),
    classification: suffix[1]?.toLocaleLowerCase('und') ?? null,
  };
}

function possibleMatchFamily(name: string): string {
  return (
    clientMatchKey(name)
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s/u, 1)[0] ?? ''
  );
}

function financialEvidence(
  candidate: RawCell,
  row: P010Row,
  status: MappingStatus,
): FinancialEvidence {
  if (typeof candidate.value !== 'number')
    throw new Error(`Valor financeiro não numérico: ${candidate.address}.`);
  return {
    raw_number: candidate.value,
    decimal_round_trip_string: candidate.round_trip_text ?? candidate.value.toString(),
    formatted_text: candidate.formatted_text ?? null,
    number_format: candidate.number_format,
    coordinate: `${row.raw_payload.sheet_key}!${candidate.address}`,
    row_hash: row.row_hash,
    mapping_status: status,
    target_field: status === 'mapped' ? 'projects.contract_value' : null,
  };
}

interface ExtractionState {
  clients: ClientCandidate[];
  projects: ProjectCandidate[];
  mappings: MappingEvidence[];
  divergences: Diagnostic[];
}

function extractCandidates(source: LoadedSource): ExtractionState {
  const monthlyRows = source.rows.get('monthly_revenue') ?? [];
  const projectRows = source.rows.get('project_values') ?? [];
  const mappings: MappingEvidence[] = [];
  const divergences: Diagnostic[] = [];
  const clientEvidence = new Map<string, { rawNames: Set<string>; origins: SourceCoordinate[] }>();
  const projectMonthly = new Map<
    string,
    {
      rawCodes: Set<string>;
      clientKeys: Set<string>;
      currencies: Set<string>;
      classifications: Set<string>;
      origins: SourceCoordinate[];
    }
  >();

  for (const row of monthlyRows.filter(
    (candidate) => candidate.source_row_number >= 4 && candidate.source_row_number <= 51,
  )) {
    const codeCell = cell(row, 'B');
    const clientCell = cell(row, 'C');
    const currencyCell = cell(row, 'H');
    const rawCode = typeof codeCell?.value === 'string' ? codeCell.value : '';
    const projectCode = rawCode.trim();
    if (!PROJECT_CODE.test(projectCode)) continue;
    const aggregate = projectMonthly.get(projectCode) ?? {
      rawCodes: new Set<string>(),
      clientKeys: new Set<string>(),
      currencies: new Set<string>(),
      classifications: new Set<string>(),
      origins: [],
    };
    aggregate.rawCodes.add(rawCode);
    if (codeCell !== undefined) {
      const sourceOrigin = coordinate(source, row, codeCell.address);
      aggregate.origins.push(sourceOrigin);
      mappings.push(
        mapping(
          'project',
          projectCode,
          'project_code',
          'Projeto LTC-M',
          rawCode,
          projectCode,
          'projects.project_code',
          'mapped',
          'Trim conservador; dígitos e zeros preservados.',
          sourceOrigin,
        ),
      );
    }
    if (typeof clientCell?.value === 'string') {
      const split = splitClientAndClassification(clientCell.value);
      const normalized = normalizeClientName(split.clientName);
      const key = clientMatchKey(normalized);
      const sourceOrigin = coordinate(source, row, clientCell.address);
      aggregate.clientKeys.add(key);
      aggregate.origins.push(sourceOrigin);
      const evidence = clientEvidence.get(key) ?? { rawNames: new Set<string>(), origins: [] };
      evidence.rawNames.add(split.clientName);
      evidence.origins.push(sourceOrigin);
      clientEvidence.set(key, evidence);
      mappings.push(
        mapping(
          'client',
          key,
          'client_name',
          'Cliente',
          clientCell.value,
          normalized,
          'clients.display_name',
          'mapped',
          split.classification === null
            ? 'Campo explícito Cliente; normalização estrita.'
            : 'Campo Cliente com sufixo explícito de classificação separado como evidência.',
          sourceOrigin,
        ),
      );
      if (split.classification !== null) {
        aggregate.classifications.add(split.classification);
        mappings.push(
          mapping(
            'project',
            projectCode,
            'raw_classification',
            'Cliente',
            split.classification,
            split.classification,
            null,
            'pending_decision',
            'D06 impede converter contrato/demanda/saldo em classificação canônica.',
            sourceOrigin,
          ),
        );
      }
    }
    if (typeof currencyCell?.value === 'string') {
      const rawCurrency = currencyCell.value;
      const normalizedCurrency = rawCurrency.trim().toUpperCase();
      const sourceOrigin = coordinate(source, row, currencyCell.address);
      aggregate.currencies.add(normalizedCurrency);
      aggregate.origins.push(sourceOrigin);
      mappings.push(
        mapping(
          'project',
          projectCode,
          'currency',
          'Moeda',
          rawCurrency,
          normalizedCurrency,
          'projects.base_currency',
          'mapped',
          'Moeda explícita da origem; nenhuma inferência por símbolo ou conversão.',
          sourceOrigin,
        ),
      );
    }
    projectMonthly.set(projectCode, aggregate);
  }

  const clients = [...clientEvidence.entries()].map(([key, evidence]) => {
    const rawNames = [...evidence.rawNames].sort(compare);
    const normalizedName = normalizeClientName(rawNames[0] ?? '');
    const base = {
      candidate_id: `client-${sha256Canonical({ entity: 'client', match_key: key }).slice(0, 24)}`,
      client_ref: `client-${sha256Canonical(key).slice(0, 12)}`,
      raw_names: rawNames,
      normalized_name: normalizedName,
      match_key: key,
      status: normalizedName === '' ? ('rejected' as const) : ('valid' as const),
      action: normalizedName === '' ? ('rejected' as const) : ('insert' as const),
      matched_client_id: null,
      possible_matches: [] as string[],
      origins: uniqueOrigins(evidence.origins),
      diagnostic_codes: normalizedName === '' ? ['CLIENT_NAME_MISSING'] : [],
      source_manifest_hash: source.manifestHash,
    };
    return { ...base, hash: sha256Canonical(base) };
  });

  const families = new Map<string, ClientCandidate[]>();
  for (const candidate of clients) {
    const family = possibleMatchFamily(candidate.normalized_name);
    families.set(family, [...(families.get(family) ?? []), candidate]);
  }
  for (const family of families.values()) {
    if (family.length < 2) continue;
    for (const candidate of family) {
      candidate.status = 'ambiguous';
      candidate.action = 'conflict';
      candidate.possible_matches = family
        .filter((other) => other.candidate_id !== candidate.candidate_id)
        .map((other) => other.client_ref)
        .sort(compare);
      candidate.diagnostic_codes = ['CLIENT_MATCH_AMBIGUOUS'];
      candidate.hash = sha256Canonical({ ...candidate, hash: undefined });
      divergences.push(
        diagnostic(
          'CLIENT_MATCH_AMBIGUOUS',
          'warning',
          'client',
          candidate.client_ref,
          'Possíveis variantes de cliente compartilham o mesmo identificador lexical; merge automático proibido.',
          'Revisar identidade jurídica e unidade antes da aplicação.',
          candidate.origins[0] ?? null,
        ),
      );
    }
  }
  const clientsByKey = new Map(clients.map((candidate) => [candidate.match_key, candidate]));
  const projectHeaderRow = rowAt(projectRows, 2);
  const projectValueRow = rowAt(projectRows, 3);
  const columns = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
  const projects: ProjectCandidate[] = [];
  for (const column of columns) {
    const headerCell = cell(projectHeaderRow, column);
    const rawLabel = typeof headerCell?.value === 'string' ? headerCell.value : '';
    const match = rawLabel.match(PROJECT_PREFIX);
    const projectCode = match?.[1] ?? '';
    const aggregate = projectMonthly.get(projectCode);
    const valueCell = cell(projectValueRow, column);
    if (
      match === null ||
      !PROJECT_CODE.test(projectCode) ||
      aggregate === undefined ||
      headerCell === undefined
    ) {
      divergences.push(
        diagnostic(
          'PROJECT_CODE_INVALID',
          'error',
          'project',
          projectCode === '' ? null : projectCode,
          'Código ausente ou inválido no resumo de projetos.',
          null,
          headerCell === undefined
            ? null
            : coordinate(source, projectHeaderRow, headerCell.address),
        ),
      );
      continue;
    }
    const labelOrigin = coordinate(source, projectHeaderRow, headerCell.address);
    const projectNameProposal = normalizeClientName(
      rawLabel.slice(match[0].length).replace(/^\s*[-_]\s*/u, ''),
    );
    mappings.push(
      mapping(
        'project',
        projectCode,
        'project_label',
        'PROJETOS LTC-M',
        rawLabel,
        projectNameProposal,
        'projects.project_name',
        'pending_decision',
        'O cabeçalho mistura cliente/unidade/descrição; proposta preservada sem aplicação automática.',
        labelOrigin,
      ),
    );
    const clientKeys = [...aggregate.clientKeys].sort(compare);
    const clientCandidate =
      clientKeys.length === 1 ? clientsByKey.get(clientKeys[0] ?? '') : undefined;
    const currencies = [...aggregate.currencies].sort(compare);
    const diagnostics = ['PROJECT_CLASSIFICATION_PENDING', 'PROJECT_DATA_REFERENCE_DATE_MISSING'];
    let action: ProjectCandidate['action'] = 'pending_decision';
    if (clientKeys.length !== 1 || clientCandidate?.status !== 'valid') {
      diagnostics.push('PROJECT_CLIENT_UNRESOLVED');
      action = 'rejected';
      divergences.push(
        diagnostic(
          'PROJECT_CLIENT_UNRESOLVED',
          'error',
          'project',
          projectCode,
          'Cliente do projeto não está resolvido de forma inequívoca.',
          'Resolver candidato de cliente antes da aplicação.',
          aggregate.origins[0] ?? labelOrigin,
        ),
      );
    }
    if (currencies.length === 0) {
      diagnostics.push('PROJECT_CURRENCY_MISSING');
      action = 'rejected';
    } else if (currencies.length > 1) {
      diagnostics.push('PROJECT_CURRENCY_AMBIGUOUS');
      action = 'rejected';
    }
    const valueEvidence: FinancialEvidence[] = [];
    let contractValue: string | null = null;
    if (valueCell !== undefined && typeof valueCell.value === 'number') {
      const approved = projectCode === '2026-04-16531' && valueCell.value === 164000;
      valueEvidence.push(
        financialEvidence(valueCell, projectValueRow, approved ? 'mapped' : 'pending_decision'),
      );
      mappings.push(
        mapping(
          'project',
          projectCode,
          'project_value',
          'Valor de Venda',
          valueCell.value,
          valueCell.round_trip_text ?? valueCell.value.toString(),
          approved ? 'projects.contract_value' : null,
          approved ? 'mapped' : 'pending_decision',
          approved
            ? 'D02 aprova 164000 especificamente para 2026-04-16531.'
            : 'D05 mantém a semântica de Valor de Venda pendente.',
          coordinate(source, projectValueRow, valueCell.address),
        ),
      );
      if (approved) contractValue = valueCell.round_trip_text ?? valueCell.value.toString();
      else diagnostics.push('PROJECT_VALUE_SEMANTICS_PENDING');
      if (projectCode === '2026-04-16531' && !approved) {
        diagnostics.push('PROJECT_VALUE_CONFLICT');
        action = 'rejected';
        divergences.push(
          diagnostic(
            'PROJECT_VALUE_CONFLICT',
            'error',
            'project',
            projectCode,
            'D02 exige exatamente 164000; 168000 ou qualquer outro valor é rejeitado.',
            null,
            coordinate(source, projectValueRow, valueCell.address),
          ),
        );
      }
    }
    if (projectCode === '2026-04-16531') {
      const monthlyValueRow = rowAt(monthlyRows, 51);
      const monthlyValueCell = cell(monthlyValueRow, 'J');
      if (monthlyValueCell?.value !== 164000) {
        diagnostics.push('PROJECT_VALUE_CONFLICT');
        action = 'rejected';
        divergences.push(
          diagnostic(
            'PROJECT_VALUE_CONFLICT',
            'error',
            'project',
            projectCode,
            'A confirmação mensal D02 não contém exatamente 164000.',
            null,
            monthlyValueCell === undefined
              ? labelOrigin
              : coordinate(source, monthlyValueRow, monthlyValueCell.address),
          ),
        );
      }
    }
    const receiptEvidence: FinancialEvidence[] = [];
    if (projectCode === '2024-02-10990') {
      const receiptRow = rowAt(monthlyRows, 45);
      const receiptCell = cell(receiptRow, 'J');
      if (receiptCell === undefined || receiptCell.value !== 369749.1735) {
        diagnostics.push('PROJECT_VALUE_CONFLICT');
        action = 'rejected';
      } else {
        receiptEvidence.push(financialEvidence(receiptCell, receiptRow, 'evidence_only'));
        diagnostics.push('RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE');
        divergences.push(
          diagnostic(
            'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE',
            'warning',
            'project',
            projectCode,
            'Previsão de recebimento preservada somente como evidência; não alimenta valor contratual ou faturamento.',
            null,
            coordinate(source, receiptRow, receiptCell.address),
          ),
        );
      }
    }
    divergences.push(
      diagnostic(
        'PROJECT_CLASSIFICATION_PENDING',
        'warning',
        'project',
        projectCode,
        'Classificação canônica não foi inferida.',
        'D06',
        labelOrigin,
      ),
    );
    if (projectCode !== '2026-04-16531') {
      divergences.push(
        diagnostic(
          'PROJECT_VALUE_SEMANTICS_PENDING',
          'warning',
          'project',
          projectCode,
          'Valor de Venda preservado sem mapeamento canônico.',
          'D05',
          valueCell === undefined
            ? labelOrigin
            : coordinate(source, projectValueRow, valueCell.address),
        ),
      );
    }
    const operationalStatus = projectCode === '2024-02-10990' ? ('completed' as const) : null;
    const base = {
      candidate_id: `project-${sha256Canonical({ entity: 'project', project_code: projectCode }).slice(0, 24)}`,
      raw_codes: [...aggregate.rawCodes].sort(compare),
      project_code: projectCode,
      raw_project_label: rawLabel,
      project_name_proposal: projectNameProposal,
      project_name_mapping_status: 'pending_decision' as const,
      client_match_key: clientKeys.length === 1 ? (clientKeys[0] ?? null) : null,
      client_candidate_id: clientCandidate?.candidate_id ?? null,
      client_id: clientCandidate?.matched_client_id ?? null,
      currency: currencies.length === 1 ? (currencies[0] ?? null) : null,
      raw_classifications: [...aggregate.classifications].sort(compare),
      classification: null,
      operational_status: operationalStatus,
      contract_value: contractValue,
      data_reference_date: null,
      value_evidence: valueEvidence,
      receipt_forecast_evidence: receiptEvidence,
      action,
      origins: uniqueOrigins([...aggregate.origins, labelOrigin]),
      diagnostic_codes: [...new Set(diagnostics)].sort(compare),
      source_manifest_hash: source.manifestHash,
    };
    projects.push({ ...base, hash: sha256Canonical(base) });
  }
  return {
    clients: clients.sort((left, right) => compare(left.match_key, right.match_key)),
    projects: projects.sort((left, right) => compare(left.project_code, right.project_code)),
    mappings: mappings.sort(
      (left, right) =>
        compare(left.entity, right.entity) ||
        compare(left.entity_key, right.entity_key) ||
        originSort(left.origin, right.origin) ||
        compare(left.source_field, right.source_field),
    ),
    divergences: divergences.sort(
      (left, right) =>
        compare(left.entity, right.entity) ||
        compare(left.entity_key ?? '', right.entity_key ?? '') ||
        compare(left.code, right.code) ||
        compare(left.hash, right.hash),
    ),
  };
}

export function applyExistingSnapshot(
  clients: ClientCandidate[],
  projects: ProjectCandidate[],
  snapshot: ExistingSnapshot,
): void {
  for (const candidate of clients) {
    if (candidate.status !== 'valid') continue;
    const matches = snapshot.clients.filter(
      (existing) =>
        clientMatchKey(existing.legal_name) === candidate.match_key ||
        clientMatchKey(existing.display_name) === candidate.match_key,
    );
    if (matches.length === 1 && matches[0]?.deleted_at === null && matches[0].active) {
      candidate.action = 'no_op';
      candidate.matched_client_id = matches[0].id;
    } else if (matches.length > 0) {
      candidate.action = 'conflict';
      candidate.status = 'ambiguous';
      candidate.diagnostic_codes = ['PROTECTED_RECORD_CONFLICT'];
    }
    candidate.hash = sha256Canonical({ ...candidate, hash: undefined });
  }
  const clientsById = new Map(clients.map((candidate) => [candidate.candidate_id, candidate]));
  for (const project of projects) {
    const client =
      project.client_candidate_id === null
        ? undefined
        : clientsById.get(project.client_candidate_id);
    if (client?.matched_client_id !== null && client?.matched_client_id !== undefined) {
      project.client_id = client.matched_client_id;
    }
    const existing = snapshot.projects.filter(
      (candidate) =>
        candidate.project_code.toUpperCase() === project.project_code.toUpperCase() &&
        candidate.deleted_at === null,
    );
    if (existing.length > 1) {
      project.action = 'conflict';
      project.diagnostic_codes = [
        ...new Set([...project.diagnostic_codes, 'PROJECT_DUPLICATE_CONFLICT']),
      ].sort(compare);
    } else if (existing.length === 1) {
      const target = existing[0];
      const fullyMapped =
        project.project_name_mapping_status === 'mapped' &&
        project.client_id !== null &&
        project.classification !== null &&
        project.operational_status !== null &&
        project.contract_value !== null &&
        project.data_reference_date !== null;
      if (
        fullyMapped &&
        target !== undefined &&
        target.project_name === project.project_name_proposal &&
        target.client_id === project.client_id &&
        target.classification === project.classification &&
        target.status === project.operational_status &&
        target.base_currency === project.currency &&
        target.contract_value === project.contract_value &&
        target.data_reference_date === project.data_reference_date
      ) {
        project.action = 'no_op';
      } else if (fullyMapped) {
        project.action = 'conflict';
        project.diagnostic_codes = [
          ...new Set([...project.diagnostic_codes, 'PROTECTED_RECORD_CONFLICT']),
        ].sort(compare);
      }
    }
    project.hash = sha256Canonical({ ...project, hash: undefined });
  }
}

function buildPlan(state: ExtractionState): ImportPlanOperation[] {
  const operations: ImportPlanOperation[] = [];
  for (const client of state.clients) {
    operations.push({
      order: 0,
      entity: 'client',
      natural_key: client.match_key,
      action: client.action,
      dependencies: [],
      expected_result:
        client.action === 'insert'
          ? 'Criar cliente somente após gate e resolução de identidade.'
          : client.action === 'no_op'
            ? 'Preservar cliente equivalente existente.'
            : 'Nenhuma escrita; revisão humana obrigatória.',
      origin_hashes: client.origins.map((origin) => origin.row_hash).sort(compare),
      candidate_hash: client.hash,
      status:
        client.action === 'insert' || client.action === 'no_op' ? 'planned' : 'requires_review',
    });
  }
  for (const project of state.projects) {
    operations.push({
      order: 0,
      entity: 'project',
      natural_key: project.project_code,
      action: project.action,
      dependencies: project.client_candidate_id === null ? [] : [project.client_candidate_id],
      expected_result:
        project.action === 'no_op'
          ? 'Preservar projeto equivalente existente.'
          : project.action === 'insert'
            ? 'Criar projeto após o cliente, em transação autorizada.'
            : 'Nenhuma escrita; pendência ou conflito preservado.',
      origin_hashes: project.origins.map((origin) => origin.row_hash).sort(compare),
      candidate_hash: project.hash,
      status:
        project.action === 'insert' || project.action === 'no_op'
          ? 'planned'
          : project.action === 'pending_decision'
            ? 'requires_review'
            : 'blocked',
    });
  }
  operations.sort(
    (left, right) =>
      compare(left.entity, right.entity) || compare(left.natural_key, right.natural_key),
  );
  operations.forEach((operation, index) => {
    operation.order = index + 1;
  });
  return operations;
}

function countActions(operations: ImportPlanOperation[]): Record<string, number> {
  return Object.fromEntries(
    ['insert', 'no_op', 'conflict', 'rejected', 'pending_decision'].map((action) => [
      action,
      operations.filter((operation) => operation.action === action).length,
    ]),
  );
}

export function normalizeP011(
  source: LoadedSource,
  snapshot: ExistingSnapshot,
  generatedAt: string,
): P011Artifacts {
  const state = extractCandidates(source);
  applyExistingSnapshot(state.clients, state.projects, snapshot);
  const operations = buildPlan(state);
  const actionCounts = countActions(operations);
  const projectCodes = state.projects.map((project) => project.project_code);
  const validationSummary = {
    contract: 'ltcm.p011.validation-summary.v1',
    status: 'passed_with_pending_decisions',
    client_candidates: state.clients.length,
    project_candidates: state.projects.length,
    unique_project_codes: new Set(projectCodes).size,
    d02_value_164000_validated:
      state.projects.find((project) => project.project_code === '2026-04-16531')?.contract_value ===
      '164000',
    d03_distinct_projects:
      projectCodes.includes('2024-10-12524') && projectCodes.includes('2025-07-14416'),
    d04_warning_propagated: state.divergences.some(
      (entry) => entry.code === 'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE',
    ),
    d05_inferred: false,
    d06_inferred: false,
    item_outputs: 0,
    competency_operations: 0,
    curve_s_operations: 0,
    p012_executed: false,
    remote_access: false,
    action_counts: actionCounts,
    warnings: state.divergences.filter((entry) => entry.severity === 'warning').length,
    errors: state.divergences.filter((entry) => entry.severity === 'error').length,
  };
  if (
    state.projects.length !== 9 ||
    new Set(projectCodes).size !== 9 ||
    !EXPECTED_PROJECT_CODES.every((code) => projectCodes.includes(code))
  ) {
    throw new Error('Dry-run P011 não produziu exatamente os nove projetos aprovados.');
  }
  const inputHash = canonicalInputHash(source.inputHashes);
  const sourceValidation = {
    contract: 'ltcm.p011.source-validation.v1',
    p010_manifest_contract: source.manifest['artifact_contract'],
    p009_payload_schema_version: source.manifest['payload_schema_version'],
    p010_manifest_hash: source.manifestHash,
    workbook_hash: source.workbookHash,
    input_hash: inputHash,
    sheet_keys: [...source.rows.keys()],
    row_counts: Object.fromEntries([...source.rows].map(([key, rows]) => [key, rows.length])),
    structural_errors: 0,
    approved_warning: 'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE',
    valid: true,
  };
  const report = [
    '# P011 — relatório sanitizado do dry-run',
    '',
    `Status: normalização concluída localmente; aplicação remota não autorizada.`,
    '',
    `- input: \`${inputHash}\`;`,
    `- workbook: \`${source.workbookHash}\`;`,
    `- clientes candidatos: ${state.clients.length} (identificados apenas por referências sanitizadas);`,
    `- projetos candidatos: ${state.projects.length};`,
    `- códigos únicos de projeto: ${new Set(projectCodes).size};`,
    `- ações simuladas: ${JSON.stringify(actionCounts)};`,
    `- warnings: ${validationSummary.warnings}; errors de candidato: ${validationSummary.errors};`,
    '- D02 validada em 164000; D03 preservada; D04 propagada somente como warning/evidência;',
    '- D05 e D06 permanecem pendentes e não foram inferidas;',
    '- zero item, competência, Curva S, P012, SQL ou acesso remoto.',
    '',
    'A correspondência de clientes ambíguos e os campos obrigatórios ainda pendentes devem ser',
    'resolvidos antes de uma autorização remota específica. O schema não oferece chave natural de',
    'cliente baseada em nome; a futura aplicação deve receber IDs resolvidos e jamais fazer upsert',
    'automático por nome.',
    '',
  ].join('\n');
  return {
    manifest: {
      artifact_contract: 'ltcm.p011.normalization-manifest.v1',
      generated_at: generatedAt,
      normalizer_version: NORMALIZER_VERSION,
      p010_manifest_hash: source.manifestHash,
      workbook_hash: source.workbookHash,
      input_hash: inputHash,
      input_hashes: source.inputHashes,
      rules: [
        'client_nfc_trim_collapse_case_insensitive',
        'client_no_accent_punctuation_suffix_word_removal',
        'project_code_trim_only',
        'explicit_currency_only',
        'd02_164000',
        'd03_distinct_projects',
        'd04_receipt_evidence_only',
        'd05_d06_pending',
        'remote_apply_blocked',
      ],
      counts: validationSummary,
      output_hashes: {},
    },
    sourceValidation,
    clients: state.clients,
    projects: state.projects,
    mappings: state.mappings,
    divergences: state.divergences,
    importPlan: { contract: 'ltcm.p011.import-plan.v1', operations },
    validationSummary,
    report,
  };
}
