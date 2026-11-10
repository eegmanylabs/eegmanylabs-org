/** One command of the tools command line. Register new commands in cli.ts. */
export interface Command {
  /** What the person types, for example "seed:demo". */
  readonly name: string;
  /** One line for the usage text. */
  readonly summary: string;
  run(args: readonly string[]): Promise<void>;
}
