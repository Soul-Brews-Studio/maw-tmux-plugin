#!/usr/bin/env bun
// maw tmux <verb> — the tmux fleet verbs, ported from maw-rs and maw-js.
//
// The tmux counterpart to maw-herdr-plugin. Pair with: maw default set tmux
import { TmuxUnreachable } from "./src/tmux.mjs";
import { ls } from "./src/ls.mjs";

const VERBS = { ls, list: ls };

const HELP = `maw tmux <verb> [args] — tmux fleet verbs

  ls [--json]        list live local sessions

With 'maw default set tmux', bare 'maw ls' routes here.
Ported from maw-rs, not forwarded to it: no maw-rs binary is required.`;

const args = process.argv.slice(2);
const verb = args[0] ?? "";
if (!verb || ["--help", "-h", "help"].includes(verb)) {
  console.log(HELP);
  process.exit(0);
}
const handler = VERBS[verb];
if (!handler) {
  console.error(`maw tmux: unknown verb "${verb}"`);
  console.error(`  maw tmux --help`);
  process.exit(2);
}
try {
  process.exit(handler(args.slice(1)) ?? 0);
} catch (error) {
  if (error instanceof TmuxUnreachable) {
    console.error(`tmux unreachable: ${error.message}`);
    console.error("  tmux new-session -d -s main");
    process.exit(1);
  }
  throw error;
}
