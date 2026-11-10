// Command line of the portal's Admin SDK tools.
//
//   npm run -w @eegml/tools cli -- <command> [arguments] [--verbose]
//
// --verbose prints the stack of an unexpected error. Without it the message is enough.
//
// Tools run with full access to the database, outside the security rules. They run only from a
// trusted environment (an administrator's machine or a protected workflow), never from the
// public site.
import type { Command } from "./command";
import { seedDemoCommand } from "./commands/seed-demo";
import { ToolRefusal } from "./environment";

/** Registry of commands. Add a new command here. */
const COMMANDS: readonly Command[] = [seedDemoCommand];

const EXIT_FAILED = 1;
const EXIT_REFUSED = 2;

function usage(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  return [
    "Usage: cli <command> [arguments] [--verbose]",
    "",
    "Commands:",
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
  ].join("\n");
}

async function main(): Promise<number> {
  const given = process.argv.slice(2);
  const verbose = given.includes("--verbose");
  const [name, ...args] = given.filter((argument) => argument !== "--verbose");
  if (name === undefined || name === "help" || name === "--help") {
    console.log(usage());
    return name === undefined ? EXIT_REFUSED : 0;
  }
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) {
    console.error(`Unknown command "${name}".\n\n${usage()}`);
    return EXIT_REFUSED;
  }
  try {
    await command.run(args);
    return 0;
  } catch (error) {
    if (error instanceof ToolRefusal) {
      console.error(error.message);
      return EXIT_REFUSED;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${command.name} failed: ${message}`);
    if (verbose) console.error(error);
    else console.error("Run the command again with --verbose to see where it failed.");
    return EXIT_FAILED;
  }
}

process.exitCode = await main();
