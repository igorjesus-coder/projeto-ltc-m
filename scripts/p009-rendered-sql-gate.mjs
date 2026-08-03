import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  renderComprehensiveP008,
  renderComprehensiveP009,
  renderScenario,
  uuidPrefixFor,
} from './sql-rendering.mjs';

export const DEFAULT_GATE_RUN_IDS = Object.freeze([
  'r20991231-gate-a1b2c3d4',
  'r20000101_gate_00000000',
]);

const MANIFEST_PATH = path.join('docs', 'database', 'p009-rendered-sql-gate-manifest.json');
const RENDER_DIRECTORY = path.join('.tmp', 'p009-rendered-sql-gate');
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;
const APP_USER_REQUIRED_COLUMNS = ['id', 'auth_subject', 'full_name', 'role', 'active'];
const VALID_ROLES = new Set(['viewer', 'editor', 'admin']);

const ARTIFACTS = Object.freeze({
  membershipPreflight: path.join('database', 'audit', 'p008-runtime', 'membership-preflight.sql'),
  membershipProof: path.join(
    'database',
    'audit',
    'p008-runtime',
    'membership-reversibility-proof.sql',
  ),
  membershipGrant: path.join('database', 'audit', 'p008-runtime', 'membership-grant.sql'),
  membershipCleanup: path.join('database', 'audit', 'p008-runtime', 'membership-cleanup.sql'),
  invalidContext: path.join('database', 'audit', 'p008-runtime', 'connection-invalid-context.sql'),
  viewer: path.join('database', 'audit', 'p008-runtime', 'connection-viewer.sql'),
  editor: path.join('database', 'audit', 'p008-runtime', 'connection-editor.sql'),
  editorWorkflow: path.join('database', 'audit', 'p008-runtime', 'connection-editor-workflow.sql'),
  admin: path.join('database', 'audit', 'p008-runtime', 'connection-admin-d23-d24.sql'),
  adminD24: path.join('database', 'audit', 'p008-runtime', 'connection-admin-d24.sql'),
  concurrency: path.join('database', 'audit', 'p008-runtime', 'connection-d23-concurrency.sql'),
  finalState: path.join('database', 'audit', 'p008-runtime', 'final-state.sql'),
  p007: path.join('database', 'audit', 'ltcm-p007-tests.sql'),
  p008: path.join('database', 'audit', 'ltcm-p008-rls-tests.sql'),
  p009Bootstrap: path.join('database', 'audit', 'ltcm-p009-bootstrap.sql'),
  p009: path.join('database', 'audit', 'ltcm-p009-staging-tests.sql'),
  structuralPostcheck: path.join('database', 'audit', 'ltcm-p008-postcheck.sql'),
  p009Postcheck: path.join('database', 'audit', 'ltcm-p009-postcheck.sql'),
  inventory: path.join('database', 'audit', 'remote-metadata-inventory.sql'),
});

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function locationAt(sql, offset) {
  const prefix = sql.slice(0, Math.max(0, offset));
  const lines = prefix.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function issue(rootSql, artifact, offset, message) {
  return { artifact, ...locationAt(rootSql, offset), message };
}

function isIdentifierStart(character) {
  return /[A-Za-z_\u0080-\uFFFF]/u.test(character ?? '');
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(character ?? '');
}

function readQuoted(sql, index, quote) {
  let cursor = index + 1;
  let value = '';
  while (cursor < sql.length) {
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] === quote) {
        value += quote;
        cursor += 2;
        continue;
      }
      return { closed: true, end: cursor + 1, value };
    }
    value += sql[cursor];
    cursor += 1;
  }
  return { closed: false, end: sql.length, value };
}

export function lexSql(sql, artifact = 'inline.sql', options = {}) {
  const rootSql = options.rootSql ?? sql;
  const baseOffset = options.baseOffset ?? 0;
  const tokens = [];
  const issues = [];
  let index = 0;
  let parenthesisDepth = 0;

  const add = (type, start, end, value = sql.slice(start, end), extra = {}) => {
    tokens.push({
      type,
      value,
      raw: sql.slice(start, end),
      start: baseOffset + start,
      end: baseOffset + end,
      ...extra,
    });
  };

  while (index < sql.length) {
    const character = sql[index];
    const code = character.charCodeAt(0);
    if (/\s/u.test(character)) {
      if (code < 32 && !['\n', '\r', '\t'].includes(character)) {
        issues.push(
          issue(rootSql, artifact, baseOffset + index, 'caractere de controle inesperado'),
        );
      }
      index += 1;
      continue;
    }

    if (character === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index + 2);
      index = end < 0 ? sql.length : end;
      continue;
    }

    if (character === '/' && sql[index + 1] === '*') {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      if (depth !== 0) {
        issues.push(
          issue(rootSql, artifact, baseOffset + start, 'comentario de bloco nao fechado'),
        );
      }
      continue;
    }

    if (character === "'") {
      const quoted = readQuoted(sql, index, "'");
      add('string', index, quoted.end, quoted.value);
      if (!quoted.closed) {
        issues.push(issue(rootSql, artifact, baseOffset + index, 'aspas simples nao balanceadas'));
      }
      index = quoted.end;
      continue;
    }

    if (character === '"') {
      const quoted = readQuoted(sql, index, '"');
      add('quoted_identifier', index, quoted.end, quoted.value);
      if (!quoted.closed) {
        issues.push(issue(rootSql, artifact, baseOffset + index, 'aspas duplas nao balanceadas'));
      } else if (quoted.value.length === 0) {
        issues.push(issue(rootSql, artifact, baseOffset + index, 'identificador citado vazio'));
      }
      index = quoted.end;
      continue;
    }

    if (character === '$') {
      const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0];
      if (tag) {
        const contentStart = index + tag.length;
        const close = sql.indexOf(tag, contentStart);
        if (close < 0) {
          add('dollar', index, sql.length, sql.slice(contentStart), {
            tag,
            contentStart: baseOffset + contentStart,
          });
          issues.push(
            issue(rootSql, artifact, baseOffset + index, `dollar quote ${tag} nao fechado`),
          );
          index = sql.length;
        } else {
          add('dollar', index, close + tag.length, sql.slice(contentStart, close), {
            tag,
            contentStart: baseOffset + contentStart,
          });
          index = close + tag.length;
        }
        continue;
      }
    }

    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index])) index += 1;
      add('word', start, index);
      continue;
    }

    if (/[0-9]/u.test(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[0-9A-Fa-f.xXeE+-]/u.test(sql[index])) index += 1;
      add('number', start, index);
      continue;
    }

    if (character === '(') parenthesisDepth += 1;
    if (character === ')') {
      parenthesisDepth -= 1;
      if (parenthesisDepth < 0) {
        issues.push(
          issue(rootSql, artifact, baseOffset + index, 'parentese de fechamento sem abertura'),
        );
        parenthesisDepth = 0;
      }
    }
    add('symbol', index, index + 1);
    index += 1;
  }

  if (parenthesisDepth !== 0) {
    issues.push(issue(rootSql, artifact, baseOffset + sql.length, 'parenteses nao balanceados'));
  }
  return { tokens, issues };
}

function collectSegments(sql, artifact) {
  const root = lexSql(sql, artifact);
  const segments = [{ artifact, sql, rootSql: sql, tokens: root.tokens, issues: root.issues }];
  const visitDollarTokens = (tokens) => {
    for (const token of tokens) {
      if (token.type !== 'dollar') continue;
      const nested = lexSql(token.value, artifact, {
        rootSql: sql,
        baseOffset: token.contentStart,
      });
      const segment = {
        artifact,
        sql: token.value,
        rootSql: sql,
        tokens: nested.tokens,
        issues: nested.issues,
        dollarTag: token.tag,
      };
      segments.push(segment);
      visitDollarTokens(nested.tokens);
    }
  };
  visitDollarTokens(root.tokens);
  return segments;
}

function tokenIs(token, value) {
  return token?.type === 'word' && token.value.toLowerCase() === value;
}

function identifierValue(token) {
  if (!['word', 'quoted_identifier'].includes(token?.type)) return null;
  return token.value;
}

function findMatchingParenthesis(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') depth += 1;
    else if (tokens[index].value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(tokens, start, end) {
  const groups = [];
  let depth = 0;
  let groupStart = start;
  for (let index = start; index < end; index += 1) {
    if (tokens[index].value === '(' || tokens[index].value === '[') depth += 1;
    else if (tokens[index].value === ')' || tokens[index].value === ']') depth -= 1;
    else if (tokens[index].value === ',' && depth === 0) {
      groups.push(tokens.slice(groupStart, index));
      groupStart = index + 1;
    }
  }
  groups.push(tokens.slice(groupStart, end));
  return groups;
}

function statementEnd(tokens, start) {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === ';') return index;
  }
  return tokens.length;
}

function expectedFailure(rootSql, start, end) {
  const sample = rootSql.slice(start, Math.min(rootSql.length, Math.max(end, start + 1600)));
  const raise = sample.search(/\braise\s+exception\b/iu);
  const handler = sample.search(/\bexception\s+when\b/iu);
  return raise >= 0 && handler >= 0 && raise < handler;
}

function parseTarget(tokens, start, stopValue = '(') {
  const parts = [];
  let index = start;
  while (index < tokens.length && tokens[index].value !== stopValue) {
    if (tokens[index].value === '.') parts.push('.');
    else {
      const value = identifierValue(tokens[index]);
      if (!value) break;
      parts.push(value);
    }
    index += 1;
  }
  return { name: parts.join(''), nextIndex: index };
}

function parseQualifiedName(tokens, start) {
  const first = identifierValue(tokens[start]);
  if (!first) return { name: '', nextIndex: start };
  if (tokens[start + 1]?.value === '.' && identifierValue(tokens[start + 2])) {
    return {
      name: `${first}.${identifierValue(tokens[start + 2])}`,
      nextIndex: start + 3,
    };
  }
  return { name: first, nextIndex: start + 1 };
}

export function analyzeInsertStatements(sql, artifact = 'inline.sql') {
  const segments = collectSegments(sql, artifact);
  const inserts = [];
  const issues = segments.flatMap((segment) => segment.issues);

  for (const segment of segments) {
    const { tokens, rootSql } = segment;
    for (let index = 0; index < tokens.length; index += 1) {
      if (!tokenIs(tokens[index], 'insert') || !tokenIs(tokens[index + 1], 'into')) continue;
      const target = parseQualifiedName(tokens, index + 2);
      const end = statementEnd(tokens, index);
      if (!target.name || tokens[target.nextIndex]?.value !== '(') {
        issues.push(
          issue(rootSql, artifact, tokens[index].start, 'INSERT sem lista explicita de colunas'),
        );
        continue;
      }

      const columnClose = findMatchingParenthesis(tokens, target.nextIndex);
      if (columnClose < 0) continue;
      const columnGroups = splitTopLevel(tokens, target.nextIndex + 1, columnClose);
      const columns = columnGroups.map((group) =>
        group.length === 1 ? identifierValue(group[0]) : null,
      );
      if (columns.length === 0 || columns.some((column) => !column)) {
        issues.push(
          issue(
            rootSql,
            artifact,
            tokens[target.nextIndex].start,
            'lista de colunas vazia ou invalida',
          ),
        );
      }
      const normalizedColumns = columns.filter(Boolean).map((column) => column.toLowerCase());
      if (new Set(normalizedColumns).size !== normalizedColumns.length) {
        issues.push(
          issue(rootSql, artifact, tokens[target.nextIndex].start, 'coluna duplicada no INSERT'),
        );
      }

      let valuesIndex = columnClose + 1;
      let insertSelect = false;
      while (valuesIndex < end && !tokenIs(tokens[valuesIndex], 'values')) {
        if (tokenIs(tokens[valuesIndex], 'select')) {
          insertSelect = true;
          break;
        }
        valuesIndex += 1;
      }
      if (insertSelect) {
        inserts.push({
          artifact,
          table: target.name.toLowerCase(),
          line: locationAt(rootSql, tokens[index].start).line,
          columns: normalizedColumns,
          tuples: [],
          insertSelect: true,
          expectedFailure: expectedFailure(
            rootSql,
            tokens[index].start,
            tokens[end - 1]?.end ?? tokens[index].end,
          ),
        });
        continue;
      }
      if (valuesIndex >= end) {
        issues.push(
          issue(rootSql, artifact, tokens[index].start, 'INSERT sem clausula VALUES analisavel'),
        );
        continue;
      }

      const tuples = [];
      let cursor = valuesIndex + 1;
      while (cursor < end) {
        if (tokens[cursor].value === ',') {
          cursor += 1;
          continue;
        }
        if (tokens[cursor].value !== '(') break;
        const close = findMatchingParenthesis(tokens, cursor);
        if (close < 0) break;
        const valueGroups = splitTopLevel(tokens, cursor + 1, close);
        tuples.push({
          arity: valueGroups.length,
          groups: valueGroups,
          line: locationAt(rootSql, tokens[cursor].start).line,
        });
        if (valueGroups.length !== columns.length) {
          issues.push(
            issue(
              rootSql,
              artifact,
              tokens[cursor].start,
              `aridade divergente em ${target.name}: ${columns.length} colunas e ${valueGroups.length} valores`,
            ),
          );
        }
        cursor = close + 1;
      }
      if (tuples.length === 0) {
        issues.push(issue(rootSql, artifact, tokens[valuesIndex].start, 'VALUES sem tupla'));
      }

      inserts.push({
        artifact,
        table: target.name.toLowerCase(),
        line: locationAt(rootSql, tokens[index].start).line,
        columns: normalizedColumns,
        tuples,
        expectedFailure: expectedFailure(
          rootSql,
          tokens[index].start,
          tokens[end - 1]?.end ?? tokens[index].end,
        ),
      });
      index = valuesIndex;
    }
  }
  return { inserts, issues, segments };
}

function validateAppUsers(inserts, rootSqlByArtifact) {
  const issues = [];
  let fixtures = 0;
  for (const insert of inserts.filter((item) => item.table === 'ltc_m.app_users')) {
    if (insert.expectedFailure) continue;
    const rootSql = rootSqlByArtifact.get(insert.artifact);
    for (const required of APP_USER_REQUIRED_COLUMNS) {
      if (!insert.columns.includes(required)) {
        issues.push(issue(rootSql, insert.artifact, 0, `fixture app_users sem coluna ${required}`));
      }
    }
    const roleIndex = insert.columns.indexOf('role');
    const activeIndex = insert.columns.indexOf('active');
    for (const tuple of insert.tuples) {
      fixtures += 1;
      const roleGroup = tuple.groups[roleIndex] ?? [];
      const activeGroup = tuple.groups[activeIndex] ?? [];
      const role =
        roleGroup.length === 1 && roleGroup[0].type === 'string' ? roleGroup[0].value : null;
      const active =
        activeGroup.length === 1 && activeGroup[0].type === 'word'
          ? activeGroup[0].value.toLowerCase()
          : null;
      if (!VALID_ROLES.has(role)) {
        issues.push(
          issue(rootSql, insert.artifact, 0, `role app_users invalida: ${role ?? 'ausente'}`),
        );
      }
      if (!['true', 'false'].includes(active)) {
        issues.push(
          issue(rootSql, insert.artifact, 0, 'fixture app_users sem active booleano explicito'),
        );
      }
      const serialized = tuple.groups
        .flat()
        .map((token) => token.raw)
        .join(' ');
      if (/inactive/iu.test(serialized) && active !== 'false') {
        issues.push(issue(rootSql, insert.artifact, 0, 'fixture inativa sem active=false'));
      }
      if (!/inactive/iu.test(serialized) && active !== 'true') {
        issues.push(issue(rootSql, insert.artifact, 0, 'fixture ativa sem active=true'));
      }
      if (/auth0\||google-oauth2\||windowslive\|/iu.test(serialized)) {
        issues.push(issue(rootSql, insert.artifact, 0, 'auth_subject real proibido em fixture'));
      }
    }
  }
  return { issues, fixtures };
}

function extractNames(segments, runId) {
  const aliases = [];
  const ctes = [];
  const prepared = [];
  const labels = [];
  const issues = [];

  for (const segment of segments) {
    const { tokens, rootSql, artifact } = segment;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type === 'word' && token.value.includes(runId)) {
        issues.push(issue(rootSql, artifact, token.start, 'run ID incorporado em identificador'));
      }
      if (tokenIs(token, 'as')) {
        const candidate = tokens[index + 1];
        const name = identifierValue(candidate);
        if (name) {
          if (!IDENTIFIER.test(name) && candidate.type !== 'quoted_identifier') {
            issues.push(issue(rootSql, artifact, candidate.start, `alias invalido: ${name}`));
          }
          if (tokens[index + 2]?.value === '-') {
            issues.push(
              issue(rootSql, artifact, candidate.start, `alias invalido com hifen: ${name}-`),
            );
          }
          aliases.push(name);
        }
      }
      if (tokenIs(token, 'with')) {
        let cursor = index + 1;
        while (cursor + 2 < tokens.length) {
          const name = identifierValue(tokens[cursor]);
          if (!name || !tokenIs(tokens[cursor + 1], 'as') || tokens[cursor + 2].value !== '(')
            break;
          ctes.push(name);
          cursor = findMatchingParenthesis(tokens, cursor + 2) + 1;
          if (tokens[cursor]?.value !== ',') break;
          cursor += 1;
        }
      }
      if (tokenIs(token, 'prepare')) {
        const name = identifierValue(tokens[index + 1]);
        if (name) prepared.push(name);
      }
      if (
        token.value === '<' &&
        tokens[index + 1]?.value === '<' &&
        identifierValue(tokens[index + 2])
      ) {
        labels.push(identifierValue(tokens[index + 2]));
      }
    }
  }
  return { aliases, ctes, prepared, labels, issues };
}

function statementMetrics(segments) {
  const types = [];
  for (const segment of segments) {
    let firstWord = null;
    for (const token of segment.tokens) {
      if (!firstWord && token.type === 'word') firstWord = token.value.toLowerCase();
      if (token.value === ';') {
        if (firstWord) types.push(firstWord);
        firstWord = null;
      }
    }
    if (firstWord) types.push(firstWord);
  }
  return { count: types.length, types };
}

function validateDangerousStatements(sql, artifact, segments) {
  const issues = [];
  const allowedMembership = new Set(['membershipProof', 'membershipGrant', 'membershipCleanup']);
  for (const segment of segments) {
    const { tokens, rootSql } = segment;
    for (let index = 0; index < tokens.length; index += 1) {
      const word = tokens[index].type === 'word' ? tokens[index].value.toLowerCase() : null;
      if (['drop', 'alter', 'truncate', 'copy'].includes(word)) {
        issues.push(
          issue(
            rootSql,
            artifact,
            tokens[index].start,
            `statement proibido: ${word.toUpperCase()}`,
          ),
        );
      }
      if (word === 'create' && tokenIs(tokens[index + 1], 'table')) {
        issues.push(
          issue(rootSql, artifact, tokens[index].start, 'statement proibido: CREATE TABLE'),
        );
      }
      if (word === 'create' && tokenIs(tokens[index + 1], 'policy')) {
        issues.push(
          issue(rootSql, artifact, tokens[index].start, 'statement proibido: CREATE POLICY'),
        );
      }
      if (['grant', 'revoke'].includes(word) && !allowedMembership.has(artifact)) {
        issues.push(
          issue(rootSql, artifact, tokens[index].start, `${word.toUpperCase()} fora do D27`),
        );
      }
      if (word === 'delete') {
        const end = statementEnd(tokens, index);
        if (
          !expectedFailure(rootSql, tokens[index].start, tokens[end - 1]?.end ?? tokens[index].end)
        ) {
          issues.push(
            issue(
              rootSql,
              artifact,
              tokens[index].start,
              'DELETE fora de assert negativo controlado',
            ),
          );
        }
      }
      if (word === 'update') {
        const end = statementEnd(tokens, index);
        const target = parseTarget(tokens, index + 1, ';').name.toLowerCase();
        const hasWhere = tokens.slice(index + 1, end).some((token) => tokenIs(token, 'where'));
        const negative = expectedFailure(
          rootSql,
          tokens[index].start,
          tokens[end - 1]?.end ?? tokens[index].end,
        );
        if (!target.startsWith('ltc_m.')) {
          issues.push(
            issue(
              rootSql,
              artifact,
              tokens[index].start,
              `UPDATE fora de ltc_m: ${target || 'alvo ausente'}`,
            ),
          );
        }
        if (!hasWhere && !negative) {
          issues.push(
            issue(rootSql, artifact, tokens[index].start, 'UPDATE sem WHERE e sem assert negativo'),
          );
        }
      }
    }
  }

  if (allowedMembership.has(artifact)) {
    const normalized = sql.replace(/\s+/gu, ' ').toLowerCase();
    if (artifact !== 'membershipCleanup' && normalized.includes('grant ')) {
      const expected =
        /grant ltc_m_runtime to postgres with admin false, inherit false, set true granted by postgres/iu;
      if (!expected.test(normalized)) issues.push(issue(sql, artifact, 0, 'GRANT D27 divergente'));
    }
    if (normalized.includes('revoke ')) {
      const expected = /revoke ltc_m_runtime from postgres granted by postgres restrict/iu;
      if (!expected.test(normalized)) issues.push(issue(sql, artifact, 0, 'REVOKE D27 divergente'));
    }
  }
  return issues;
}

function canonicalTokenStream(sql, artifact, runId) {
  const normalizeString = (value) =>
    value.replaceAll(runId, '<RUN_ID>').replaceAll(uuidPrefixFor(runId), '<UUID_PREFIX>');
  const canonicalize = (tokens) =>
    tokens.map((token) => {
      if (token.type === 'string') return ['string', normalizeString(token.value)];
      if (token.type === 'dollar') {
        const nested = lexSql(token.value, artifact);
        return ['dollar', token.tag, canonicalize(nested.tokens)];
      }
      return [token.type, token.type === 'word' ? token.value.toLowerCase() : token.value];
    });
  return canonicalize(lexSql(sql, artifact).tokens);
}

export function validateSqlArtifact(sql, artifact = 'inline', runId = 'r20991231-gate-test') {
  const analysis = analyzeInsertStatements(sql, artifact);
  const names = extractNames(analysis.segments, runId);
  const appUsers = validateAppUsers(analysis.inserts, new Map([[artifact, sql]]));
  const issues = [
    ...analysis.issues,
    ...names.issues,
    ...appUsers.issues,
    ...validateDangerousStatements(sql, artifact, analysis.segments),
  ];
  for (const segment of analysis.segments) {
    const last = segment.tokens.at(-1);
    if (last && last.value !== ';') {
      issues.push(
        issue(sql, artifact, last.end, 'statement truncado ou sem ponto e virgula final'),
      );
    }
    for (const token of segment.tokens) {
      if (token.type === 'word' && ['undefined', 'nan'].includes(token.value.toLowerCase())) {
        issues.push(issue(sql, artifact, token.start, `literal proibido: ${token.value}`));
      }
    }
  }
  for (const pattern of ['{{', '}}', '<%=', '%>', '__RUN_ID__']) {
    const offset = sql.indexOf(pattern);
    if (offset >= 0) issues.push(issue(sql, artifact, offset, `placeholder residual: ${pattern}`));
  }
  return {
    ok: issues.length === 0,
    issues,
    inserts: analysis.inserts,
    aliases: names.aliases,
    ctes: names.ctes,
    statements: statementMetrics(analysis.segments),
    canonical: canonicalTokenStream(sql, artifact, runId),
  };
}

function renderArtifact(name, source, runId) {
  if (name === 'p008') return renderComprehensiveP008(source, runId);
  if (name === 'p009' || name === 'p009Bootstrap') return renderComprehensiveP009(source, runId);
  if (
    [
      'invalidContext',
      'viewer',
      'editor',
      'editorWorkflow',
      'admin',
      'adminD24',
      'concurrency',
    ].includes(name)
  ) {
    return renderScenario(source, runId);
  }
  return source;
}

export function renderSqlBundle(rootDirectory, runId) {
  return Object.fromEntries(
    Object.entries(ARTIFACTS).map(([name, relativePath]) => {
      const source = fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8');
      return [name, { sourcePath: relativePath, source, sql: renderArtifact(name, source, runId) }];
    }),
  );
}

export function validateSqlBundle(rootDirectory, runId) {
  const bundle = renderSqlBundle(rootDirectory, runId);
  const issues = [];
  const inserts = [];
  const aliases = [];
  const ctes = [];
  const statementTypes = [];
  const rootSqlByArtifact = new Map();
  const sourceFiles = [];

  for (const [artifact, entry] of Object.entries(bundle)) {
    rootSqlByArtifact.set(artifact, entry.sql);
    sourceFiles.push({ artifact, path: entry.sourcePath, sha256: sha256(entry.source) });
    const analysis = analyzeInsertStatements(entry.sql, artifact);
    inserts.push(...analysis.inserts);
    issues.push(...analysis.issues);
    const names = extractNames(analysis.segments, runId);
    aliases.push(...names.aliases.map((name) => ({ artifact, name })));
    ctes.push(...names.ctes.map((name) => ({ artifact, name })));
    issues.push(...names.issues);
    const metrics = statementMetrics(analysis.segments);
    statementTypes.push(...metrics.types.map((type) => ({ artifact, type })));
    issues.push(...validateDangerousStatements(entry.sql, artifact, analysis.segments));

    for (const segment of analysis.segments) {
      const last = segment.tokens.at(-1);
      if (last && last.value !== ';') {
        issues.push(
          issue(entry.sql, artifact, last.end, 'statement truncado ou sem ponto e virgula final'),
        );
      }
      for (const token of segment.tokens) {
        if (token.type === 'word' && ['undefined', 'nan'].includes(token.value.toLowerCase())) {
          issues.push(issue(entry.sql, artifact, token.start, `literal proibido: ${token.value}`));
        }
      }
    }
    for (const pattern of ['{{', '}}', '<%=', '%>', '__RUN_ID__']) {
      const offset = entry.sql.indexOf(pattern);
      if (offset >= 0)
        issues.push(issue(entry.sql, artifact, offset, `placeholder residual: ${pattern}`));
    }
  }

  const appUsers = validateAppUsers(inserts, rootSqlByArtifact);
  issues.push(...appUsers.issues);
  if (!aliases.some((item) => item.name === 'p009_rejection_partial_integrity')) {
    issues.push(
      issue(bundle.p009.sql, 'p009', 0, 'alias p009_rejection_partial_integrity ausente'),
    );
  }

  const canonical = Object.fromEntries(
    Object.entries(bundle).map(([artifact, entry]) => [
      artifact,
      canonicalTokenStream(entry.sql, artifact, runId),
    ]),
  );
  const renderedSql = Object.fromEntries(
    Object.entries(bundle).map(([artifact, entry]) => [artifact, entry.sql]),
  );
  const statementTypeCounts = Object.fromEntries(
    [...new Set(statementTypes.map(({ type }) => type))]
      .sort()
      .map((type) => [type, statementTypes.filter((item) => item.type === type).length]),
  );
  return {
    runId,
    ok: issues.length === 0,
    issues,
    sourceFiles,
    sourceHash: sha256(JSON.stringify(sourceFiles)),
    renderedHash: sha256(JSON.stringify(renderedSql)),
    canonicalHash: sha256(JSON.stringify(canonical)),
    canonical,
    renderedSql,
    metrics: {
      statements: statementTypes.length,
      statementTypeCounts,
      inserts: inserts.length,
      tuples: inserts.reduce((total, insert) => total + insert.tuples.length, 0),
      aliases: aliases.length,
      ctes: ctes.length,
      appUsersFixtures: appUsers.fixtures,
      requestContexts: (bundle.p009.sql.match(/^-- p009-context /gmu) ?? []).length,
      postDmlContextAssertions: (bundle.p009.source.match(/@p009-after-dml /gu) ?? []).length,
      auditedRequestScenarios: (bundle.p009.source.match(/@p009-audit /gu) ?? []).length,
    },
    inserts: inserts.map((insert) => ({
      artifact: insert.artifact,
      table: insert.table,
      line: insert.line,
      columns: insert.columns.length,
      tupleArities: insert.tuples.map((tuple) => tuple.arity),
      expectedFailure: insert.expectedFailure,
    })),
  };
}

export function buildGateManifest(rootDirectory, runIds = DEFAULT_GATE_RUN_IDS) {
  if (runIds.length !== 2 || runIds[0] === runIds[1])
    throw new Error('gate exige dois run IDs distintos');
  const runs = runIds.map((runId) => validateSqlBundle(rootDirectory, runId));
  const invariant = JSON.stringify(runs[0].canonical) === JSON.stringify(runs[1].canonical);
  const parity = runs.every((run) =>
    run.inserts.every((insert) => insert.tupleArities.every((arity) => arity === insert.columns)),
  );
  const issues = runs.flatMap((run) => run.issues.map((item) => ({ runId: run.runId, ...item })));
  if (!invariant)
    issues.push({
      runId: null,
      artifact: null,
      line: 1,
      column: 1,
      message: 'run ID altera a estrutura SQL',
    });

  const manifest = {
    formatVersion: 1,
    decision: 'D33',
    status: issues.length === 0 ? 'approved' : 'rejected',
    runIds,
    sourceHash: runs[0].sourceHash,
    sourceFiles: runs[0].sourceFiles,
    rendered: runs.map((run) => ({
      runId: run.runId,
      sha256: run.renderedHash,
      canonicalSha256: run.canonicalHash,
      metrics: run.metrics,
      inserts: run.inserts,
    })),
    gates: {
      lexicalStructure: runs.every((run) => run.ok),
      identifiersAndAliases: !issues.some((item) =>
        /alias|identificador|run ID incorporado/iu.test(item.message),
      ),
      insertColumnValueParity: parity,
      appUsersFixtures: !issues.some((item) =>
        /app_users|fixture ativa|fixture inativa|active=/iu.test(item.message),
      ),
      placeholders: !issues.some((item) =>
        /placeholder residual|literal proibido: (?:undefined|nan)/iu.test(item.message),
      ),
      forbiddenStatements: !issues.some((item) =>
        /proibido|fora do D27|DELETE fora|UPDATE fora/iu.test(item.message),
      ),
      runIdInvariant: invariant,
      requestContextFlow: runs.every(
        (run) =>
          run.metrics.requestContexts === 13 &&
          run.metrics.postDmlContextAssertions === 13 &&
          run.metrics.auditedRequestScenarios >= 8,
      ),
    },
    positiveTests: [
      'alias valido',
      'run ID com hifen',
      'run ID com underscore',
      'INSERT correto',
      'multiplas tuplas corretas',
      'virgulas em string, JSON, funcao e comentario',
      'dollar quote e parenteses aninhados',
      'fixtures app_users ativa e inativa',
      'invariancia estrutural entre run IDs',
      'dois request IDs distintos com contexto, DML e auditoria',
      'setup substituido pelo contexto do cenário',
    ],
    negativeTests: [
      'alias com hifen',
      'INSERT com mais valores',
      'INSERT com menos valores',
      'tuplas com aridades divergentes',
      'placeholder residual',
      'undefined e NaN',
      'statement proibido',
      'app_users quatro colunas/cinco valores',
      'app_users cinco colunas/quatro valores',
      'app_users ativa/inativa divergente',
      'expectativa de request divergente do contexto',
      'DML sem contexto e vazamento entre transações/conexões',
    ],
    issues,
  };
  manifest.manifestSha256 = sha256(JSON.stringify(manifest));
  return { manifest, runs };
}

function writeGateArtifacts(rootDirectory, result) {
  const renderRoot = path.join(rootDirectory, RENDER_DIRECTORY);
  fs.mkdirSync(renderRoot, { recursive: true });
  for (const run of result.runs) {
    const safeRunId = run.runId.replace(/[^A-Za-z0-9_-]/gu, '_');
    const runDirectory = path.join(renderRoot, safeRunId);
    fs.mkdirSync(runDirectory, { recursive: true });
    for (const [artifact, sql] of Object.entries(run.renderedSql)) {
      fs.writeFileSync(path.join(runDirectory, `${artifact}.sql`), sql, 'utf8');
    }
  }
  const manifestPath = path.join(rootDirectory, MANIFEST_PATH);
  fs.writeFileSync(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  return { manifestPath, renderRoot };
}

function parseOptions(argv) {
  const options = { write: false, runIds: [...DEFAULT_GATE_RUN_IDS] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') options.write = true;
    else if (argv[index] === '--run-id-a') {
      options.runIds[0] = argv.at(index + 1);
      index += 1;
    } else if (argv[index] === '--run-id-b') {
      options.runIds[1] = argv.at(index + 1);
      index += 1;
    } else throw new Error(`argumento desconhecido: ${argv[index]}`);
  }
  if (options.runIds.some((runId) => !runId || !/^[A-Za-z0-9_-]{6,64}$/u.test(runId))) {
    throw new Error('run IDs do gate devem conter 6 a 64 caracteres seguros');
  }
  return options;
}

function main() {
  try {
    const options = parseOptions(process.argv.slice(2));
    const result = buildGateManifest(process.cwd(), options.runIds);
    const written = options.write ? writeGateArtifacts(process.cwd(), result) : null;
    console.log(
      JSON.stringify(
        {
          status: result.manifest.status,
          manifestSha256: result.manifest.manifestSha256,
          rendered: result.manifest.rendered.map((run) => ({
            runId: run.runId,
            sha256: run.sha256,
            metrics: run.metrics,
          })),
          gates: result.manifest.gates,
          issues: result.manifest.issues,
          written,
        },
        null,
        2,
      ),
    );
    if (result.manifest.status !== 'approved') process.exitCode = 1;
  } catch (error) {
    console.error(`Gate SQL P009 falhou: ${error.message}`);
    process.exitCode = 2;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
