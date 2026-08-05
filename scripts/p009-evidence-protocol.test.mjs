import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createP009TerminalEnvelope,
  parseP009TerminalEnvelope,
  runCapturedProcess,
  sha256File,
  terminateProcessTree,
} from './p009-evidence-protocol.mjs';

function killError(code, message = `falha sintetica ${code}`) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fakeWindowsKiller() {
  const killer = new EventEmitter();
  killer.stderr = new EventEmitter();
  return killer;
}

function payload(overrides = {}) {
  return {
    protocol_version: 'P009_RESULT_V1',
    run_id: 'r20260803-d33-test',
    status: 'passed',
    started_at: '2026-08-03T00:00:00.000Z',
    finished_at: '2026-08-03T00:00:01.000Z',
    duration_ms: 1000,
    phase_a: { passed: true, rolled_back: true },
    phase_b: { started: true, passed: true },
    p009: {
      batches: true,
      sheets: true,
      staging: true,
      errors: true,
      partial_rejection: true,
      immutability: true,
      audit_sanitized: true,
      rls_viewer: true,
      rls_editor: true,
      rls_admin: true,
      invalid_context: true,
    },
    audit_requests: [
      { scenario: 'batch_create', configured: 'request-a', audited: 'request-a', passed: true },
    ],
    regressions: { p007: true, p008: true, d23_concurrency: true, d24: true },
    cleanup: {
      finally_completed: true,
      rollback_clean: true,
      d26_exact: true,
      grantor_postgres_count: 0,
      locks_remaining: 0,
    },
    final_state: {
      brl_count: 1,
      us_count: 1,
      app_users: 0,
      audit_log: 0,
      import_batches: 0,
      import_batch_sheets: 0,
      import_staging_rows: 0,
      import_row_errors: 0,
    },
    fingerprints: { external: 'a'.repeat(64), ltc_m: 'b'.repeat(64), migrations: 'c'.repeat(64) },
    artifacts: {
      stdout_sha256: 'd'.repeat(64),
      stderr_sha256: 'e'.repeat(64),
      manifest_sha256: 'f'.repeat(64),
      pre_inventory_sha256: '1'.repeat(64),
      post_inventory_sha256: '2'.repeat(64),
    },
    first_error: null,
    ...overrides,
  };
}

test('aceita envelope unico em LF e CRLF somente apos close', () => {
  const line = createP009TerminalEnvelope(payload());
  assert.equal(parseP009TerminalEnvelope(`${line}\n`, { closed: true }).payload.status, 'passed');
  assert.equal(
    parseP009TerminalEnvelope(`log\r\n${line}\r\n`, { closed: true }).payload.run_id,
    'r20260803-d33-test',
  );
  assert.throws(() => parseP009TerminalEnvelope(line, { closed: false }), /apos close/u);
});

test('captura saida maior que a real, chunks divididos e stderr intercalado', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p009-d33-output-'));
  const line = createP009TerminalEnvelope(payload());
  const script = `
    const line = ${JSON.stringify(line)};
    process.stdout.write('x'.repeat(2 * 1024 * 1024) + '\\n');
    process.stderr.write('stderr-a\\n');
    process.stdout.write(line.slice(0, 17));
    setTimeout(() => {
      process.stderr.write('stderr-b\\n');
      process.stdout.write(line.slice(17) + '\\r\\n');
    }, 25);
  `;
  const result = await runCapturedProcess(process.execPath, ['-e', script], {
    timeoutMs: 5000,
    stdoutPath: path.join(directory, 'stdout.bin'),
    stderrPath: path.join(directory, 'stderr.bin'),
  });
  assert.equal(result.ok, true);
  assert.ok(result.stdoutBytes > 2 * 1024 * 1024);
  assert.match(result.stderr, /stderr-a[\s\S]*stderr-b/u);
  assert.equal(
    parseP009TerminalEnvelope(result.stdout, { closed: result.closed }).payload.status,
    'passed',
  );
  assert.equal(sha256File(path.join(directory, 'stdout.bin')), result.stdoutSha256);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('aguarda atraso superior ao timeout externo anterior e preserva codigos 0 e 1', async () => {
  const passed = createP009TerminalEnvelope(payload());
  const delayed = await runCapturedProcess(
    process.execPath,
    ['-e', `setTimeout(() => process.stdout.write(${JSON.stringify(`${passed}\n`)}), 1250);`],
    { timeoutMs: 3000 },
  );
  assert.equal(delayed.ok, true);
  assert.ok(delayed.durationMs >= 1200);
  assert.equal(
    parseP009TerminalEnvelope(delayed.stdout, { closed: delayed.closed }).payload.status,
    'passed',
  );

  const failedLine = createP009TerminalEnvelope(
    payload({ status: 'failed', first_error: 'synthetic' }),
  );
  const failed = await runCapturedProcess(
    process.execPath,
    ['-e', `process.stdout.write(${JSON.stringify(`${failedLine}\n`)}); process.exitCode = 1;`],
    { timeoutMs: 3000 },
  );
  assert.equal(failed.code, 1);
  assert.equal(failed.ok, false);
  assert.equal(
    parseP009TerminalEnvelope(failed.stdout, { closed: failed.closed }).payload.status,
    'failed',
  );
});

test('preserva falhas por sinal e erro de spawn', async () => {
  const signaled = await runCapturedProcess(
    process.execPath,
    ['-e', "process.kill(process.pid, 'SIGTERM');"],
    { timeoutMs: 3000 },
  );
  assert.equal(signaled.ok, false);
  if (process.platform !== 'win32') {
    assert.equal(signaled.code, null);
    assert.equal(signaled.signal, 'SIGTERM');
  } else {
    assert.ok(signaled.code !== 0 || signaled.signal !== null);
  }

  const missingCommand = path.join(os.tmpdir(), `p009-missing-${process.pid}-${Date.now()}`);
  const spawnFailed = await runCapturedProcess(missingCommand, [], { timeoutMs: 3000 });
  assert.equal(spawnFailed.ok, false);
  assert.equal(spawnFailed.closed, true);
  assert.equal(typeof spawnFailed.error, 'string');
  assert.ok(spawnFailed.error.length > 0);
});

test('encerramento POSIX distingue sucesso, ESRCH e fallback direto', async () => {
  const groupCalls = [];
  const groupSucceeded = await terminateProcessTree(101, 'linux', {
    killProcess(targetPid, signal) {
      groupCalls.push([targetPid, signal]);
    },
  });
  assert.deepEqual(groupSucceeded, { ok: true, code: null, error: null });
  assert.deepEqual(groupCalls, [[-101, 'SIGKILL']]);

  const fallbackCalls = [];
  const fallbackSucceeded = await terminateProcessTree(102, 'linux', {
    killProcess(targetPid, signal) {
      fallbackCalls.push([targetPid, signal]);
      if (targetPid < 0) throw killError('EPERM');
    },
  });
  assert.deepEqual(fallbackSucceeded, { ok: true, code: null, error: null });
  assert.deepEqual(fallbackCalls, [
    [-102, 'SIGKILL'],
    [102, 'SIGKILL'],
  ]);

  const missingCalls = [];
  const alreadyMissing = await terminateProcessTree(103, 'linux', {
    killProcess(targetPid, signal) {
      missingCalls.push([targetPid, signal]);
      throw killError('ESRCH');
    },
  });
  assert.deepEqual(alreadyMissing, { ok: true, code: null, error: null });
  assert.deepEqual(missingCalls, [
    [-103, 'SIGKILL'],
    [103, 'SIGKILL'],
  ]);
});

test('encerramento POSIX rejeita EPERM, erro generico e falha total', async () => {
  for (const code of ['EPERM', 'EIO']) {
    const calls = [];
    const result = await terminateProcessTree(201, 'linux', {
      killProcess(targetPid, signal) {
        calls.push([targetPid, signal]);
        throw killError(code);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, null);
    assert.match(result.error, new RegExp(code, 'u'));
    assert.deepEqual(calls, [
      [-201, 'SIGKILL'],
      [201, 'SIGKILL'],
    ]);
  }

  const mixedFailure = await terminateProcessTree(202, 'linux', {
    killProcess(targetPid) {
      if (targetPid < 0) throw killError('EPERM');
      throw killError('ESRCH');
    },
  });
  assert.equal(mixedFailure.ok, false);
  assert.equal(mixedFailure.code, null);
  assert.match(mixedFailure.error, /EPERM/u);
});

test('encerrador Windows ignora error e close tardios apos finalizar', async () => {
  const errorFirstKiller = fakeWindowsKiller();
  const errorFirstFallbacks = [];
  const errorFirstPromise = terminateProcessTree(301, 'win32', {
    spawnProcess: () => errorFirstKiller,
    killProcess: (...args) => errorFirstFallbacks.push(args),
  });
  errorFirstKiller.emit('error', new Error('taskkill indisponivel'));
  const errorFirstResult = await errorFirstPromise;
  errorFirstKiller.emit('close', 0);
  assert.deepEqual(errorFirstResult, {
    ok: false,
    code: null,
    error: 'taskkill indisponivel',
  });
  assert.equal(errorFirstFallbacks.length, 1);

  const closeFirstKiller = fakeWindowsKiller();
  const closeFirstFallbacks = [];
  const closeFirstPromise = terminateProcessTree(302, 'win32', {
    spawnProcess: () => closeFirstKiller,
    killProcess: (...args) => closeFirstFallbacks.push(args),
  });
  closeFirstKiller.emit('close', 0);
  const closeFirstResult = await closeFirstPromise;
  closeFirstKiller.emit('error', new Error('erro tardio'));
  assert.deepEqual(closeFirstResult, { ok: true, code: 0, error: null });
  assert.equal(closeFirstFallbacks.length, 0);
});

test('rejeita ausencia, duplicidade, truncamento, corrupcao e log posterior', () => {
  const line = createP009TerminalEnvelope(payload());
  assert.throws(
    () => parseP009TerminalEnvelope('sem envelope\n', { closed: true }),
    /encontrados 0/u,
  );
  assert.throws(
    () => parseP009TerminalEnvelope(`${line}\n${line}\n`, { closed: true }),
    /encontrados 2/u,
  );
  assert.throws(() => parseP009TerminalEnvelope(`${line.slice(0, -8)}\n`, { closed: true }));
  const corrupted = `${line.slice(0, -1)}${line.endsWith('0') ? '1' : '0'}`;
  assert.throws(() => parseP009TerminalEnvelope(`${corrupted}\n`, { closed: true }), /hash/u);
  assert.throws(
    () => parseP009TerminalEnvelope(`${line}\nlog tardio\n`, { closed: true }),
    /posterior/u,
  );
});

test('timeout encerra a arvore e somente resolve depois de close', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p009-d33-tree-'));
  const marker = path.join(directory, 'orphan.txt');
  const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 900); setTimeout(() => {}, 5000);`;
  const parent = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setTimeout(() => {}, 5000);`;
  try {
    const result = await runCapturedProcess(process.execPath, ['-e', parent], { timeoutMs: 150 });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.closed, true);
    assert.ok(result.exitObservedAt !== null);
    assert.ok(result.closeObservedAt >= result.exitObservedAt);
    assert.equal(result.termination.ok, true);
    assert.equal(result.termination.error, null);
    assert.equal(result.termination.code, process.platform === 'win32' ? 0 : null);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
