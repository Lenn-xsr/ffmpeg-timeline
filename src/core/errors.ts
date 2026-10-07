/**
 * Thrown when a project cannot be rendered as written. Each issue is a
 * self-contained message prefixed with the path of the offending field,
 * e.g. `tracks[1].transform[0].scale: must be a number in (0, 1]`.
 */
export class ValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}
