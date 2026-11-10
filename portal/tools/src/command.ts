/** One command of the tools command line. Register new commands in cli.ts. */
export interface Command {
  /** What the person types, for example "seed:demo". */
  readonly name: string;
  /** One line for the usage text. */
  readonly summary: string;
  /**
   * Runs the command. A command that ends without a number has succeeded. A number is the exit
   * status of an outcome that is no failure of the tool, such as an import that a check blocks.
   */
  run(args: readonly string[]): Promise<number | undefined>;
}
