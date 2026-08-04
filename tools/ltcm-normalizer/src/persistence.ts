import type { ClientCandidate, ProjectCandidate } from './types.js';

export interface ClientInsertInput {
  candidateId: string;
  legalName: string;
  displayName: string;
}

export interface ProjectInsertInput {
  candidateId: string;
  projectCode: string;
  projectName: string;
  clientCandidateId: string;
  classification: 'full_contract' | 'demand' | 'opening_balance';
  status: 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  baseCurrency: string;
  contractValue: string;
  dataReferenceDate: string;
}

export interface PreparedPersistenceBatch {
  contract: 'ltcm.p011.persistence-batch.v1';
  isolation: 'serializable';
  source: 'import';
  physicalDeletes: false;
  bypassRls: false;
  existingClients: Array<{ candidateId: string; targetId: string }>;
  clients: ClientInsertInput[];
  projects: ProjectInsertInput[];
}

export interface PersistenceRecordResult {
  candidateId: string;
  outcome: 'inserted' | 'no_op' | 'conflict';
  targetId: string | null;
}

export interface LtcmPersistenceTransaction {
  insertClient(input: ClientInsertInput): Promise<PersistenceRecordResult>;
  insertProject(
    input: ProjectInsertInput,
    resolvedClientId: string,
  ): Promise<PersistenceRecordResult>;
}

export interface LtcmPersistencePort {
  serializableTransaction<T>(
    work: (transaction: LtcmPersistenceTransaction) => Promise<T>,
  ): Promise<T>;
}

export function preparePersistenceBatch(
  clients: ClientCandidate[],
  projects: ProjectCandidate[],
): PreparedPersistenceBatch {
  const clientInputs = clients
    .filter((candidate) => candidate.action === 'insert' && candidate.status === 'valid')
    .map((candidate) => ({
      candidateId: candidate.candidate_id,
      legalName: candidate.normalized_name,
      displayName: candidate.normalized_name,
    }));
  const existingClients = clients
    .filter(
      (candidate) =>
        candidate.action === 'no_op' &&
        candidate.status === 'valid' &&
        candidate.matched_client_id !== null,
    )
    .map((candidate) => ({
      candidateId: candidate.candidate_id,
      targetId: candidate.matched_client_id as string,
    }));
  const eligibleClientIds = new Set(
    clients
      .filter(
        (candidate) =>
          ['insert', 'no_op'].includes(candidate.action) && candidate.status === 'valid',
      )
      .map((candidate) => candidate.candidate_id),
  );
  const projectInputs = projects
    .filter((candidate) => candidate.action === 'insert')
    .map((candidate) => {
      if (
        candidate.project_name_mapping_status !== 'mapped' ||
        candidate.client_candidate_id === null ||
        !eligibleClientIds.has(candidate.client_candidate_id) ||
        candidate.classification === null ||
        candidate.operational_status === null ||
        candidate.currency === null ||
        candidate.contract_value === null ||
        candidate.data_reference_date === null
      ) {
        throw new Error(
          `Projeto não resolvido entrou no lote de persistência: ${candidate.project_code}.`,
        );
      }
      return {
        candidateId: candidate.candidate_id,
        projectCode: candidate.project_code,
        projectName: candidate.project_name_proposal,
        clientCandidateId: candidate.client_candidate_id,
        classification: candidate.classification,
        status: candidate.operational_status,
        baseCurrency: candidate.currency,
        contractValue: candidate.contract_value,
        dataReferenceDate: candidate.data_reference_date,
      };
    });
  return {
    contract: 'ltcm.p011.persistence-batch.v1',
    isolation: 'serializable',
    source: 'import',
    physicalDeletes: false,
    bypassRls: false,
    existingClients,
    clients: clientInputs,
    projects: projectInputs,
  };
}

export async function executePreparedBatch(
  port: LtcmPersistencePort,
  batch: PreparedPersistenceBatch,
): Promise<PersistenceRecordResult[]> {
  return port.serializableTransaction(async (transaction) => {
    const results: PersistenceRecordResult[] = [];
    const clientIds = new Map(
      batch.existingClients.map((client) => [client.candidateId, client.targetId]),
    );
    results.push(
      ...batch.existingClients.map((client) => ({
        candidateId: client.candidateId,
        outcome: 'no_op' as const,
        targetId: client.targetId,
      })),
    );
    for (const client of batch.clients) {
      const result = await transaction.insertClient(client);
      results.push(result);
      if (result.targetId !== null) clientIds.set(client.candidateId, result.targetId);
      if (result.outcome === 'conflict') return results;
    }
    for (const project of batch.projects) {
      const resolvedClientId = clientIds.get(project.clientCandidateId);
      if (resolvedClientId === undefined) {
        results.push({ candidateId: project.candidateId, outcome: 'conflict', targetId: null });
        continue;
      }
      results.push(await transaction.insertProject(project, resolvedClientId));
    }
    return results;
  });
}
