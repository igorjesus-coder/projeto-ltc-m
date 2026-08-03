#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeArtifacts } from './artifact-writer.js';
import { extractWorkbook } from './extractor.js';

interface CliOptions {
  inputPath: string;
  outputDir: string;
  strict: boolean;
}

const USAGE = `Uso:
  npm run ltcm:extract -- --input "C:\\caminho\\arquivo.xlsx" --output-dir ".artifacts\\p010" [--strict]

Opções:
  --input <arquivo.xlsx>  Arquivo Excel de origem.
  --output-dir <diretório> Diretório local gerenciado para os artefatos.
  --strict                Eleva desvios estruturais a erros de validação.
  --help                  Exibe esta ajuda.`;

export function parseArguments(arguments_: string[]): CliOptions | 'help' {
  let inputPath: string | undefined;
  let outputDir: string | undefined;
  let strict = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const rawArgument = arguments_[index];
    const argument = rawArgument?.startsWith('^--') ? rawArgument.replaceAll('^', '') : rawArgument;
    if (argument === '--help' || argument === '-h') return 'help';
    if (argument === '--strict') {
      if (strict) throw new Error('A opção --strict foi informada mais de uma vez.');
      strict = true;
      continue;
    }
    const inlineOption = argument?.match(/^(--input|--output-dir)=(.*)$/u);
    if (inlineOption) {
      const [, option, value] = inlineOption;
      if (value === undefined || value === '') throw new Error(`Valor ausente para ${option}.`);
      if (option === '--input') {
        if (inputPath !== undefined)
          throw new Error('A opção --input foi informada mais de uma vez.');
        inputPath = value;
      } else {
        if (outputDir !== undefined)
          throw new Error('A opção --output-dir foi informada mais de uma vez.');
        outputDir = value;
      }
      continue;
    }
    if (argument === '--input' || argument === '--output-dir') {
      const valueParts: string[] = [];
      let valueIndex = index + 1;
      while (valueIndex < arguments_.length && !arguments_[valueIndex]?.startsWith('--')) {
        valueParts.push(arguments_[valueIndex] ?? '');
        valueIndex += 1;
      }
      if (valueParts.length === 0) throw new Error(`Valor ausente para ${argument}.`);
      const value = valueParts.join(' ');
      if (argument === '--input') {
        if (inputPath !== undefined)
          throw new Error('A opção --input foi informada mais de uma vez.');
        inputPath = value;
      } else {
        if (outputDir !== undefined)
          throw new Error('A opção --output-dir foi informada mais de uma vez.');
        outputDir = value;
      }
      index = valueIndex - 1;
      continue;
    }
    throw new Error(`Opção desconhecida: ${argument ?? ''}.`);
  }
  if (inputPath === undefined) throw new Error('A opção --input é obrigatória.');
  if (outputDir === undefined) throw new Error('A opção --output-dir é obrigatória.');
  return { inputPath: path.resolve(inputPath), outputDir: path.resolve(outputDir), strict };
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

  if (
    options.outputDir === path.dirname(options.inputPath) ||
    options.inputPath.startsWith(`${options.outputDir}${path.sep}`)
  ) {
    process.stderr.write(
      'O arquivo de entrada não pode estar dentro do diretório de saída gerenciado.\n',
    );
    process.exitCode = 2;
    return;
  }

  try {
    const result = await extractWorkbook(options);
    await writeArtifacts(options.outputDir, result);
    const summary = result.manifest.extraction;
    process.stdout.write(
      `P010 ${summary.status}: ${summary.operational_sheet_count} aba(s), ${summary.staged_row_count} linha(s), ${summary.error_count} erro(s), ${summary.warning_count} aviso(s).\n`,
    );
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`Falha P010: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) await main();
