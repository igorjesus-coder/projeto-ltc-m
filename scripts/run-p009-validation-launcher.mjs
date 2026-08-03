import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  parseP009TerminalEnvelope,
  runCapturedProcess,
  sha256File,
} from './p009-evidence-protocol.mjs';

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function runLauncher(rootDirectory = process.cwd(), options = {}) {
  const tempRoot = path.join(rootDirectory, '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDirectory = fs.mkdtempSync(path.join(tempRoot, 'p009-d33-launcher-'));
  const artifactDirectory = path.join(tempDirectory, 'worker-artifacts');
  fs.mkdirSync(artifactDirectory);
  const workerStdout = path.join(tempDirectory, 'worker.stdout');
  const workerStderr = path.join(tempDirectory, 'worker.stderr');
  const workerScript = path.join(rootDirectory, 'scripts', 'run-p008-dynamic-validation.mjs');
  let finalLine = null;
  let exitCode = 1;
  try {
    const result = await runCapturedProcess(
      process.execPath,
      [workerScript, '--worker', '--artifact-directory', artifactDirectory],
      {
        cwd: rootDirectory,
        timeoutMs: options.timeoutMs ?? 600_000,
        stdoutPath: workerStdout,
        stderrPath: workerStderr,
      },
    );
    const parsed = parseP009TerminalEnvelope(result.stdout, { closed: result.closed });
    const payload = parsed.payload;
    assertCondition(
      (payload.status === 'passed' && result.code === 0) ||
        (payload.status !== 'passed' && result.code === 1),
      'codigo de saida diverge do status terminal',
    );
    for (const [field, filename] of [
      ['stdout_sha256', 'subprocess.stdout'],
      ['stderr_sha256', 'subprocess.stderr'],
      ['pre_inventory_sha256', 'inventory.pre.json'],
      ['post_inventory_sha256', 'inventory.post.json'],
    ]) {
      assertCondition(
        sha256File(path.join(artifactDirectory, filename)) === payload.artifacts[field],
        `hash do artefato ${field} divergiu`,
      );
    }
    const evidence = {
      protocol: payload.protocol_version,
      envelope_sha256: parsed.sha256,
      worker_exit_code: result.code,
      worker_close_observed: result.closed,
      worker_exit_observed_at: result.exitObservedAt,
      worker_close_observed_at: result.closeObservedAt,
      worker_stdout_sha256: result.stdoutSha256,
      worker_stderr_sha256: result.stderrSha256,
      worker_stdout_bytes: result.stdoutBytes,
      worker_stderr_bytes: result.stderrBytes,
      timed_out: result.timedOut,
    };
    writeJson(
      path.join(rootDirectory, 'docs', 'database', 'p009-runtime-validation-result.json'),
      payload,
    );
    writeJson(
      path.join(rootDirectory, 'docs', 'database', 'p009-runtime-terminal-evidence.json'),
      evidence,
    );
    finalLine = parsed.line;
    exitCode = payload.status === 'passed' ? 0 : 1;
    return { payload, evidence, line: parsed.line, exitCode };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
    if (finalLine !== null && options.emit !== false) process.stdout.write(`${finalLine}\n`);
    if (options.emit !== false) process.exitCode = exitCode;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    await runLauncher();
  } catch (error) {
    process.stderr.write(`Falha do launcher D33: ${error.message}\n`);
    process.exitCode = 1;
  }
}
