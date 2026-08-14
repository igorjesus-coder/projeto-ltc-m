#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeP011Artifacts } from './artifact-writer.js';
import { normalizeP011 } from './normalizer.js';
import {
  assertSafeOutput,
  loadP010Source,
  loadReviewedResolutions,
  loadSnapshot,
} from './source-reader.js';

interface CliOptions {
  inputDir: string;
  outputDir: string;
  existingSnapshot: string | undefined;
  reviewedResolutions: string | undefined;
  generatedAt: string;
  strict: boolean;
}

const USAGE = `Uso:
  npm run ltcm:normalize-projects -- --input-dir ".artifacts\\p010-real-run-a" --output-dir ".artifacts\\p011-dry-run" [--strict]

Opções:
  --input-dir <diretório>       Artefatos canônicos P010.
  --output-dir <diretório>      Saída gerenciada dentro de .artifacts.
  --existing-snapshot <json>    Snapshot sintético/opcional do destino.
  --reviewed-resolutions <json> Decisões locais revisadas e vinculadas ao dry-run.
  --generated-at <ISO UTC>      Timestamp determinístico; padrão 1970-01-01T00:00:00.000Z.
  --strict                      Exige o perfil real aprovado.
  --apply                       Sempre bloqueado: REMOTE_APPLY_NOT_AUTHORIZED.
  --help                        Exibe esta ajuda.`;

function optionValue(arguments_: string[], index: number, option: string): [string, number] {
  const argument = arguments_[index] ?? '';
  const inline = argument.match(new RegExp(`^${option}=(.*)$`, 'u'));
  if (inline) {
    if (inline[1] === '') throw new Error(`Valor ausente para ${option}.`);
    return [inline[1] ?? '', index];
  }
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new Error(`Valor ausente para ${option}.`);
  return [value, index + 1];
}

export function parseArguments(arguments_: string[]): CliOptions | 'help' {
  let inputDir: string | undefined;
  let outputDir: string | undefined;
  let existingSnapshot: string | undefined;
  let reviewedResolutions: string | undefined;
  let generatedAt = '1970-01-01T00:00:00.000Z';
  let strict = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? '';
    if (argument === '--help' || argument === '-h') return 'help';
    if (argument === '--apply') throw new Error('REMOTE_APPLY_NOT_AUTHORIZED');
    if (argument === '--strict') {
      if (strict) throw new Error('--strict informado mais de uma vez.');
      strict = true;
      continue;
    }
    const option = [
      '--input-dir',
      '--output-dir',
      '--existing-snapshot',
      '--reviewed-resolutions',
      '--generated-at',
    ].find((candidate) => argument === candidate || argument.startsWith(`${candidate}=`));
    if (option === undefined) throw new Error(`Opção desconhecida: ${argument}.`);
    const [value, consumed] = optionValue(arguments_, index, option);
    index = consumed;
    if (option === '--input-dir') {
      if (inputDir !== undefined) throw new Error('--input-dir informado mais de uma vez.');
      inputDir = value;
    } else if (option === '--output-dir') {
      if (outputDir !== undefined) throw new Error('--output-dir informado mais de uma vez.');
      outputDir = value;
    } else if (option === '--existing-snapshot') {
      if (existingSnapshot !== undefined)
        throw new Error('--existing-snapshot informado mais de uma vez.');
      existingSnapshot = value;
    } else if (option === '--reviewed-resolutions') {
      if (reviewedResolutions !== undefined)
        throw new Error('--reviewed-resolutions informado mais de uma vez.');
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
        throw new Error('--reviewed-resolutions aceita somente arquivo local, nunca URL.');
      }
      reviewedResolutions = value;
    } else {
      generatedAt = value;
    }
  }
  if (inputDir === undefined || outputDir === undefined) {
    throw new Error('--input-dir e --output-dir são obrigatórios.');
  }
  const parsedDate = new Date(generatedAt);
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString() !== generatedAt) {
    throw new Error('--generated-at deve ser ISO UTC canônico com milissegundos.');
  }
  return {
    inputDir: path.resolve(inputDir),
    outputDir: path.resolve(outputDir),
    existingSnapshot: existingSnapshot === undefined ? undefined : path.resolve(existingSnapshot),
    reviewedResolutions:
      reviewedResolutions === undefined ? undefined : path.resolve(reviewedResolutions),
    generatedAt,
    strict,
  };
}

async function main(): Promise<void> {
  let options: CliOptions | 'help';
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (options === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  try {
    const source = await loadP010Source(options.inputDir);
    const outputDir = await assertSafeOutput(options.outputDir, source.inputDir);
    const snapshot = await loadSnapshot(options.existingSnapshot);
    const reviewedResolutions = await loadReviewedResolutions(options.reviewedResolutions);
    const artifacts = normalizeP011(source, snapshot, options.generatedAt, reviewedResolutions);
    await writeP011Artifacts(outputDir, artifacts);
    const summary = artifacts.validationSummary;
    const actions = summary['action_counts'] as Record<string, number>;
    process.stdout.write(
      [
        `P011 input=${String(artifacts.manifest['input_hash'])}`,
        `clientes=${String(summary['client_candidates'])}`,
        `projetos=${String(summary['project_candidates'])}`,
        `inserts=${String(actions['insert'] ?? 0)}`,
        `no_ops=${String(actions['no_op'] ?? 0)}`,
        `conflicts=${String(actions['conflict'] ?? 0)}`,
        `rejected=${String(actions['rejected'] ?? 0)}`,
        `pending=${String(actions['pending_decision'] ?? 0)}`,
        `warnings=${String(summary['warnings'])}`,
        `errors=${String(summary['errors'])}`,
        `output=${path.relative(process.cwd(), outputDir)}`,
      ].join(' ') + '\n',
    );
  } catch (error) {
    process.stderr.write(`Falha P011: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const direct =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
