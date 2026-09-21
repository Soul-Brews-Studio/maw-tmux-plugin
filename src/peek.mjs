import { tmux } from "./tmux.mjs";
import { resolveTmuxTarget } from "./resolve.mjs";

// Ported from maw-js cmdTmuxPeek. Two deliberate changes:
//   - no hostExec: capture-pane runs locally through argv, never a remote shell
//   - no shell string: maw-js interpolated the target into `tmux capture-pane
//     -pt '<target>' ...`, so a target containing a quote reached sh. argv
//     arguments cannot be re-parsed, so that whole class is gone.

const USAGE = `usage: maw tmux peek <target> [--lines N] [--history]
  target: pane id (%N), session:w.p, team-agent name, or session name`;

export function peek(argv) {
  let target;
  let lines = 30;
  let history = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--history") history = true;
    else if (arg === "--lines" || arg.startsWith("--lines=")) {
      const raw = arg.startsWith("--lines=") ? arg.slice("--lines=".length) : argv[++i];
      if (!/^\d+$/.test(raw ?? "") || Number(raw) === 0) {
        console.error(`maw tmux peek: --lines needs a positive whole number, got "${raw ?? ""}"`);
        console.error(`  maw tmux peek ${target ?? "<target>"} --lines 30`);
        return 2;
      }
      lines = Number(raw);
    } else if (arg.startsWith("-")) {
      console.error(`maw tmux peek: unknown option "${arg}"`);
      console.error(`  maw tmux peek <target> [--lines N] [--history]`);
      return 2;
    } else if (target === undefined) target = arg;
    else {
      console.error(`maw tmux peek: unexpected extra argument "${arg}"`);
      console.error(`  maw tmux peek ${target}`);
      return 2;
    }
  }
  if (!target) {
    console.error("maw tmux peek: a target is required");
    console.error(USAGE);
    console.error("  maw tmux ls          list live sessions to pick a target from");
    return 2;
  }

  const resolution = resolveTmuxTarget(target);
  if (resolution.ambiguous) {
    console.error(`maw tmux peek: "${target}" matches multiple sessions`);
    for (const name of resolution.ambiguous.slice(0, 10)) console.error(`  maw tmux peek ${name}`);
    return 1;
  }
  const { resolved, source } = resolution;
  const scroll = history ? ["-S", "-"] : ["-S", `-${lines}`];
  const out = tmux(["capture-pane", "-p", "-t", resolved, ...scroll, "-J"]);

  const label = `▸ ${target} → ${resolved} [${source}]`;
  console.log(process.env.NO_COLOR !== undefined ? label : `\u001b[90m${label}\u001b[0m`);
  process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
  return 0;
}
