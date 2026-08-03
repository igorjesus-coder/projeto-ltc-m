import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const P009_PROTOCOL_VERSION = 'P009_RESULT_V1';

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHash(value, field) {
  assertCondition(/^[0-9a-f]{64}$/u.test(value), `${field} deve ser SHA-256 hexadecimal minusculo`);
}

export function validateP009ResultPayload(payload) {
  assertCondition(payload && typeof payload === 'object', 'payload terminal deve ser objeto');
  assertCondition(payload.protocol_version === P009_PROTOCOL_VERSION, 'protocol_version invalida');
  assertCondition(/^[a-z0-9][a-z0-9-]{5,39}$/u.test(payload.run_id), 'run_id invalido');
  assertCondition(['passed', 'failed', 'critical'].includes(payload.status), 'status invalido');
  assertCondition(!Number.isNaN(Date.parse(payload.started_at)), 'started_at invalido');
  assertCondition(!Number.isNaN(Date.parse(payload.finished_at)), 'finished_at invalido');
  assertCondition(
    Number.isInteger(payload.duration_ms) && payload.duration_ms >= 0,
    'duration_ms invalido',
  );

  for (const [name, fields] of [
    ['phase_a', ['passed', 'rolled_back']],
    ['phase_b', ['started', 'passed']],
    [
      'p009',
      [
        'batches',
        'sheets',
        'staging',
        'errors',
        'partial_rejection',
        'immutability',
        'audit_sanitized',
        'rls_viewer',
        'rls_editor',
        'rls_admin',
        'invalid_context',
      ],
    ],
    ['regressions', ['p007', 'p008', 'd23_concurrency', 'd24']],
    ['cleanup', ['finally_completed', 'rollback_clean', 'd26_exact']],
  ]) {
    assertCondition(payload[name] && typeof payload[name] === 'object', `${name} ausente`);
    for (const field of fields) {
      assertCondition(typeof payload[name][field] === 'boolean', `${name}.${field} invalido`);
    }
  }

  assertCondition(Array.isArray(payload.audit_requests), 'audit_requests ausente');
  for (const item of payload.audit_requests) {
    assertCondition(
      typeof item.scenario === 'string' && item.scenario.length > 0,
      'cenario de auditoria invalido',
    );
    assertCondition(typeof item.configured === 'string', 'request configurado invalido');
    assertCondition(typeof item.audited === 'string', 'request auditado invalido');
    assertCondition(typeof item.passed === 'boolean', 'resultado de request invalido');
  }

  assertCondition(
    Number.isInteger(payload.cleanup.grantor_postgres_count),
    'grantor_postgres_count invalido',
  );
  assertCondition(Number.isInteger(payload.cleanup.locks_remaining), 'locks_remaining invalido');
  for (const field of [
    'brl_count',
    'us_count',
    'app_users',
    'audit_log',
    'import_batches',
    'import_batch_sheets',
    'import_staging_rows',
    'import_row_errors',
  ]) {
    assertCondition(
      Number.isInteger(payload.final_state?.[field]),
      `final_state.${field} invalido`,
    );
  }
  for (const field of ['external', 'ltc_m', 'migrations'])
    assertHash(payload.fingerprints?.[field], `fingerprints.${field}`);
  for (const field of [
    'stdout_sha256',
    'stderr_sha256',
    'manifest_sha256',
    'pre_inventory_sha256',
    'post_inventory_sha256',
  ]) {
    assertHash(payload.artifacts?.[field], `artifacts.${field}`);
  }
  assertCondition(
    payload.first_error === null || typeof payload.first_error === 'string',
    'first_error invalido',
  );
  return payload;
}

export function createP009TerminalEnvelope(payload) {
  validateP009ResultPayload(payload);
  const json = JSON.stringify(payload);
  const bytes = Buffer.from(json, 'utf8');
  const encoded = bytes.toString('base64url');
  return `${P009_PROTOCOL_VERSION}\t${encoded}\t${sha256Bytes(bytes)}`;
}

export function parseP009TerminalEnvelope(stdout, options = {}) {
  assertCondition(options.closed === true, 'envelope so pode ser analisado apos close');
  const normalized = String(stdout).replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith(P009_PROTOCOL_VERSION));
  assertCondition(
    matches.length === 1,
    `esperado um envelope terminal; encontrados ${matches.length}`,
  );
  const match = matches[0];
  assertCondition(
    lines.slice(match.index + 1).every((line) => line.length === 0),
    'log posterior ao envelope terminal',
  );
  const parts = match.line.split('\t');
  assertCondition(
    parts.length === 3 && parts[0] === P009_PROTOCOL_VERSION,
    'formato do envelope invalido',
  );
  assertCondition(
    /^[A-Za-z0-9_-]+$/u.test(parts[1]) && !parts[1].includes('='),
    'Base64url invalido',
  );
  assertHash(parts[2], 'hash do envelope');
  const bytes = Buffer.from(parts[1], 'base64url');
  assertCondition(sha256Bytes(bytes) === parts[2], 'hash do envelope divergente');
  const json = bytes.toString('utf8');
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('JSON terminal truncado ou corrompido');
  }
  assertCondition(JSON.stringify(payload) === json, 'JSON terminal nao e compacto/canonico');
  validateP009ResultPayload(payload);
  return { line: match.line, payload, sha256: parts[2] };
}

export function terminateProcessTree(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0)
    return Promise.resolve({ ok: false, code: null, error: 'PID invalido' });
  if (platform === 'win32') {
    return new Promise((resolve) => {
      const taskkillPath = path.join(
        process.env.SystemRoot ?? String.raw`C:\Windows`,
        'System32',
        'taskkill.exe',
      );
      const killer = spawn(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stderrChunks = [];
      killer.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
      killer.once('error', (error) => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // O processo pode ter encerrado durante a tentativa.
        }
        resolve({ ok: false, code: null, error: error.message });
      });
      killer.once('close', (code) => {
        const error = Buffer.concat(stderrChunks).toString('utf8').trim();
        if (code !== 0) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // O processo pode ter encerrado durante a tentativa.
          }
        }
        resolve({ ok: code === 0, code, error: error || null });
      });
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // O processo ja encerrou.
    }
  }
  return Promise.resolve({ ok: true, code: null, error: null });
}

export function runCapturedProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 120_000;
    for (const filePath of [options.stdoutPath, options.stderrPath].filter(Boolean)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (!options.append || !fs.existsSync(filePath)) fs.writeFileSync(filePath, Buffer.alloc(0));
    }
    const stdoutFd = options.stdoutPath ? fs.openSync(options.stdoutPath, 'a') : null;
    const stderrFd = options.stderrPath ? fs.openSync(options.stderrPath, 'a') : null;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    let exitObservedAt = null;
    let spawnError = null;
    let termination = Promise.resolve(null);
    let finalized = false;

    child.stdout.on('data', (chunk) => {
      const bytes = Buffer.from(chunk);
      stdoutChunks.push(bytes);
      if (stdoutFd !== null) fs.writeSync(stdoutFd, bytes);
    });
    child.stderr.on('data', (chunk) => {
      const bytes = Buffer.from(chunk);
      stderrChunks.push(bytes);
      if (stderrFd !== null) fs.writeSync(stderrFd, bytes);
    });
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('exit', () => {
      exitObservedAt = Date.now();
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      termination = terminateProcessTree(child.pid);
    }, timeoutMs);

    child.once('close', async (code, signal) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout);
      const terminationResult = await termination;
      if (stdoutFd !== null) fs.closeSync(stdoutFd);
      if (stderrFd !== null) fs.closeSync(stderrFd);
      const stdoutBytes = Buffer.concat(stdoutChunks);
      const stderrBytes = Buffer.concat(stderrChunks);
      resolve({
        ok: code === 0 && !timedOut && !spawnError,
        code,
        signal,
        timedOut,
        closed: true,
        exitObservedAt,
        closeObservedAt: Date.now(),
        stdout: stdoutBytes.toString('utf8'),
        stderr: stderrBytes.toString('utf8'),
        stdoutBytes: stdoutBytes.length,
        stderrBytes: stderrBytes.length,
        stdoutSha256: sha256Bytes(stdoutBytes),
        stderrSha256: sha256Bytes(stderrBytes),
        durationMs: Date.now() - startedAt,
        error: spawnError?.message ?? null,
        termination: terminationResult,
      });
    });
  });
}
