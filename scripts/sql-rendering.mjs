import { createHash } from 'node:crypto';

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const P009_SCENARIO_NAME = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*$/u;
const P009_REQUIRED_SCENARIOS = Object.freeze([
  'setup:users',
  'batch:create',
  'batch:update',
  'sheet:create',
  'sheet:update',
  'staging:create',
  'staging:update',
  'error:append',
  'partial-rejection',
  'immutability',
  'rls:viewer',
  'rls:editor',
  'rls:admin',
]);

export function p009ScenarioRequestId(runId, scenario) {
  assertCondition(/^[A-Za-z0-9_-]{6,64}$/u.test(runId), 'run ID P009 inválido');
  assertCondition(P009_SCENARIO_NAME.test(scenario), `cenário P009 inválido: ${scenario}`);
  const requestId = `${runId}:p009:${scenario}`;
  assertCondition(requestId.length <= 200, `request ID P009 excede 200 caracteres: ${scenario}`);
  return requestId;
}

export function validateP009ScenarioSource(source, requiredScenarios = P009_REQUIRED_SCENARIOS) {
  const contexts = [
    ...source.matchAll(/^\s*-- @p009-context ([^\s]+) (system|viewer|editor|admin)\s*$/gmu),
  ];
  const dml = [...source.matchAll(/^\s*-- @p009-dml ([^\s]+)\s*$/gmu)];
  const afterDml = [...source.matchAll(/^\s*-- @p009-after-dml ([^\s]+)\s*$/gmu)];
  const audits = [
    ...source.matchAll(/^\s*-- @p009-audit ([^\s]+) \{\{P009_REQUEST:([^}]+)\}\}\s*$/gmu),
  ];
  const issues = [];
  const contextByScenario = new Map();
  const dmlByScenario = new Map();
  const afterDmlByScenario = new Map();

  for (const match of contexts) {
    const scenario = match[1];
    if (!P009_SCENARIO_NAME.test(scenario))
      issues.push(`cenário de contexto inválido: ${scenario}`);
    if (contextByScenario.has(scenario)) issues.push(`contexto P009 duplicado: ${scenario}`);
    contextByScenario.set(scenario, { actor: match[2], index: match.index });
  }
  for (const match of dml) {
    const scenario = match[1];
    if (dmlByScenario.has(scenario)) issues.push(`marcador DML P009 duplicado: ${scenario}`);
    dmlByScenario.set(scenario, match.index);
    const context = contextByScenario.get(scenario);
    if (!context) issues.push(`DML P009 sem contexto: ${scenario}`);
    else if (context.index > match.index)
      issues.push(`contexto P009 posterior ao DML: ${scenario}`);
  }
  for (const match of afterDml) {
    const scenario = match[1];
    if (afterDmlByScenario.has(scenario)) {
      issues.push(`assertion pos-DML P009 duplicada: ${scenario}`);
    }
    afterDmlByScenario.set(scenario, match.index);
    const context = contextByScenario.get(scenario);
    const dmlIndex = dmlByScenario.get(scenario);
    if (!context) issues.push(`assertion pos-DML P009 sem contexto: ${scenario}`);
    if (dmlIndex === undefined) issues.push(`assertion pos-DML P009 sem DML: ${scenario}`);
    else if (dmlIndex > match.index)
      issues.push(`assertion pos-DML P009 anterior ao DML: ${scenario}`);
  }
  for (const match of audits) {
    const [scenario, expectedScenario] = [match[1], match[2]];
    if (scenario !== expectedScenario) {
      issues.push(`expectativa de request divergente: ${scenario} != ${expectedScenario}`);
    }
    const context = contextByScenario.get(scenario);
    const dmlIndex = dmlByScenario.get(scenario);
    if (!context) issues.push(`auditoria P009 sem contexto: ${scenario}`);
    if (dmlIndex === undefined) issues.push(`auditoria P009 sem DML: ${scenario}`);
    else if (dmlIndex > match.index) issues.push(`auditoria P009 anterior ao DML: ${scenario}`);
  }
  for (const scenario of requiredScenarios) {
    if (!contextByScenario.has(scenario))
      issues.push(`cenário P009 obrigatório ausente: ${scenario}`);
    if (!dmlByScenario.has(scenario)) issues.push(`DML P009 obrigatório ausente: ${scenario}`);
  }
  for (const scenario of requiredScenarios) {
    if (!afterDmlByScenario.has(scenario)) {
      issues.push(`assertion pos-DML P009 obrigatoria ausente: ${scenario}`);
    }
  }
  if (/p009-request-setup/iu.test(source)) issues.push('contexto setup legado ainda presente');

  assertCondition(issues.length === 0, issues.join('; '));
  return {
    contexts: contexts.map((match) => ({ scenario: match[1], actor: match[2] })),
    dml: dml.map((match) => match[1]),
    afterDml: afterDml.map((match) => match[1]),
    audits: audits.map((match) => match[1]),
  };
}

export function validateRequestAuditTrace(events) {
  const connections = new Map();
  for (const event of events) {
    const key = event.connection;
    if (event.type === 'begin') {
      assertCondition(!connections.has(key), `transação já ativa na conexão ${key}`);
      connections.set(key, { requestId: null, dml: new Map() });
      continue;
    }
    const state = connections.get(key);
    assertCondition(state, `evento ${event.type} fora de transação na conexão ${key}`);
    if (event.type === 'set-context') {
      state.requestId = event.requestId;
    } else if (event.type === 'dml') {
      assertCondition(state.requestId, `DML sem request no contexto: ${event.scenario}`);
      state.dml.set(event.scenario, state.requestId);
    } else if (event.type === 'audit') {
      const configured = state.dml.get(event.scenario);
      assertCondition(configured, `auditoria sem DML: ${event.scenario}`);
      assertCondition(
        event.expectedRequestId === configured,
        `expectativa diverge do contexto: ${event.expectedRequestId} != ${configured}`,
      );
      assertCondition(
        event.auditedRequestId === configured,
        `auditoria diverge do contexto: ${event.auditedRequestId} != ${configured}`,
      );
    } else if (event.type === 'rollback' || event.type === 'commit') {
      connections.delete(key);
    } else {
      throw new Error(`evento de trace desconhecido: ${event.type}`);
    }
  }
  return true;
}

export function uuidPrefixFor(runId) {
  const hex = createHash('sha256').update(runId, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 27)}`;
}

export function renderScenario(source, runId) {
  const uuidPrefix = uuidPrefixFor(runId);
  return source.replaceAll('{{RUN_TOKEN}}', runId).replaceAll('{{UUID_PREFIX}}', uuidPrefix);
}

export function renderComprehensiveP008(source, runId) {
  const uuidPrefix = uuidPrefixFor(runId);
  return source
    .replaceAll('00000000-0000-4000-8000-000000008', uuidPrefix)
    .replaceAll('p008', `p008-${runId}`)
    .replaceAll('P008', `P008-${runId}`);
}

export function assertValidP009Aliases(source) {
  const aliases = [...source.matchAll(/\bas\s+(p009[^\s,;)]+)/giu)].map((match) => match[1]);
  const invalidAliases = aliases.filter((alias) => !/^p009[a-z0-9_]*$/iu.test(alias));
  assertCondition(
    invalidAliases.length === 0,
    `alias SQL P009 renderizado invalido: ${invalidAliases.join(', ')}`,
  );
  return source;
}

export function renderComprehensiveP009(source, runId) {
  const uuidPrefix = uuidPrefixFor(runId);
  const flow = source.includes('@p009-context')
    ? validateP009ScenarioSource(source)
    : { contexts: [], dml: [], afterDml: [], audits: [] };
  const scenarios = new Map(flow.contexts.map((item) => [item.scenario, item.actor]));
  const actorSql = {
    system: { id: 'null', subject: 'null', source: 'system' },
    viewer: { id: `'${uuidPrefix}001'`, subject: "'p009|viewer'", source: 'api' },
    editor: { id: `'${uuidPrefix}002'`, subject: "'p009|editor'", source: 'api' },
    admin: { id: `'${uuidPrefix}003'`, subject: "'p009|admin'", source: 'api' },
  };
  const withContexts = source.replace(
    /^\s*-- @p009-context ([^\s]+) (system|viewer|editor|admin)\s*$/gmu,
    (_marker, scenario, actor) => {
      const requestId = p009ScenarioRequestId(runId, scenario);
      const label = scenario.replaceAll(':', '_').replaceAll('-', '_');
      const identity = actorSql[actor];
      return `-- p009-context ${scenario} ${requestId}
select ltc_m.set_actor_context(
    ${identity.id},
    ${identity.subject},
    '${requestId}',
    null,
    '${identity.source}',
    false
);

do $p009_context_${label}$
begin
    if nullif(pg_catalog.current_setting('ltc_m.request_id', true), '')
        is distinct from '${requestId}'
    then
        raise exception 'P009 D32 falhou: contexto divergente para ${scenario}.';
    end if;
end;
$p009_context_${label}$;`;
    },
  );
  const withPostconditions = withContexts.replace(
    /^\s*-- @p009-after-dml ([^\s]+)\s*$/gmu,
    (_marker, scenario) => {
      assertCondition(
        scenarios.has(scenario),
        `pos-DML referencia cenario sem contexto: ${scenario}`,
      );
      const requestId = p009ScenarioRequestId(runId, scenario);
      const label = scenario.replaceAll(':', '_').replaceAll('-', '_');
      return `do $p009_after_dml_${label}$
begin
    if nullif(pg_catalog.current_setting('ltc_m.request_id', true), '')
        is distinct from '${requestId}'
    then
        raise exception 'P009 D32 falhou: contexto mudou durante o DML de ${scenario}.';
    end if;
end;
$p009_after_dml_${label}$;`;
    },
  );
  const withRequests = withPostconditions.replace(
    /\{\{P009_REQUEST:([^}]+)\}\}/gu,
    (_placeholder, scenario) => {
      assertCondition(
        scenarios.has(scenario),
        `request referencia cenário sem contexto: ${scenario}`,
      );
      return p009ScenarioRequestId(runId, scenario);
    },
  );
  const rendered = withRequests
    .replaceAll('00000000-0000-4000-8000-000000009', uuidPrefix)
    .replaceAll("'p009", `'p009-${runId}`)
    .replaceAll("'P009", `'P009-${runId}`);
  return assertValidP009Aliases(rendered);
}
