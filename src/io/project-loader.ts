import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '../core/errors.js';
import type { Project } from '../core/schema.js';
import { validateProject } from '../core/validation.js';

export interface LoadedProject {
  project: Project;
  /** Directory of the project file; relative paths in the project resolve against it. */
  projectDir: string;
  /** Absolute path of every track's media file, in track order (base first). */
  inputs: string[];
}

/** Reads a project file, validates it and makes sure the media it references exists. */
export async function loadProject(projectFile: string): Promise<LoadedProject> {
  const absolutePath = path.resolve(projectFile);
  const projectDir = path.dirname(absolutePath);

  let raw: string;
  try {
    raw = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`Project file not found: ${absolutePath}`, { cause: error });
    }
    throw new Error(`Could not read project file ${absolutePath}: ${messageOf(error)}`, {
      cause: error,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${absolutePath}: ${messageOf(error)}`, { cause: error });
  }

  const project = validateProject(json);
  const inputs = project.tracks.map((track) => path.resolve(projectDir, track.source));

  const missing: string[] = [];
  for (const [index, input] of inputs.entries()) {
    if (!(await exists(input))) {
      missing.push(`tracks[${index}].source: file not found: ${input}`);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError(missing);
  }

  return { project, projectDir, inputs };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
