import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmux } from "./tmux.mjs";
import { liveSessions } from "./resolve.mjs";
import { readOracles, readFleet } from "./registry.mjs";
import { attach } from "./attach.mjs";

// maw wake, local tier. Resolves an oracle to its checkout, then wakes its
// window in the fleet session that already owns it.
//
// It will NOT invent a session number. maw-rs allocates the "<NN>-<name>"
// prefix itself, and a session created under a number maw-rs would not have
// chosen becomes a second, competing fleet entry for the same oracle. When no
// entry exists this prints the commands that create one properly.

const DEFAULT_ENGINE = "claude --model sonnet --continue";

const USAGE = `usage: maw tmux wake <target> [--attach|-a] [--no-attach] [--session <name>] [--dry-run]`;

const color = (code, value) => process.env.NO_COLOR !== undefined ? value : `\u001b[${code}m${value}\u001b[0m`;

function engineCommand() {
  for (const path of [
    process.env.MAW_CONFIG_DIR && join(process.env.MAW_CONFIG_DIR, "maw.config.json"),
    join(homedir(), ".config", "maw", "maw.config.json"),
  ].filter(Boolean)) {
    if (!existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      const command = config?.commands?.default;
      if (typeof command === "string" && command.trim()) return command;
    } catch { /* fall through to the default engine */ }
  }
  return DEFAULT_ENGINE;
}

export function resolveOracle(target) {
  const oracles = readOracles();
  const q = target.trim().toLowerCase();
  for (const pool of [
    oracles.filter(o => o.name.toLowerCase() === q),
    oracles.filter(o => o.name.toLowerCase().startsWith(q)),
    oracles.filter(o => o.name.toLowerCase().includes(q)),
  ]) {
    if (pool.length === 1) return { oracle: pool[0] };
    if (pool.length > 1) return { ambiguous: pool };
  }
  return {};
}

// The fleet entry that already owns a window for this oracle. That is where the
// session number lives, and reusing it is what keeps maw-rs and this in sync.
export function fleetSessionFor(name) {
  const target = name.toLowerCase();
  const entry = readFleet().find(row =>
    row.windows.some(window => typeof window?.name === "string" && window.name.toLowerCase() === target));
  return entry?.name;
}

export function wake(argv) {
  let target;
  let session;
  let dryRun = false;
  let wantAttach;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--attach" || arg === "-a") wantAttach = true;
    else if (arg === "--no-attach") wantAttach = false;
    else if (arg === "--session" || arg.startsWith("--session=")) {
      session = arg.startsWith("--session=") ? arg.slice("--session=".length) : argv[++i];
      if (!session) { console.error("maw tmux wake: --session needs a name"); console.error(`  ${USAGE}`); return 2; }
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      // Accepted for command-line compatibility with maw-rs; the checkout is
      // resolved from the oracle registry either way.
      if (!arg.includes("=")) i++;
    } else if (arg.startsWith("-")) {
      console.error(`maw tmux wake: unknown option "${arg}"`);
      console.error(`  ${USAGE}`);
      return 2;
    } else if (target === undefined) target = arg;
    else {
      console.error(`maw tmux wake: unexpected extra argument "${arg}"`);
      console.error(`  maw tmux wake ${target}`);
      return 2;
    }
  }
  if (!target) {
    console.error("maw tmux wake: a target is required");
    console.error(USAGE);
    console.error("  maw tmux ls          list live sessions");
    return 2;
  }

  const resolved = resolveOracle(target);
  if (resolved.ambiguous) {
    console.error(`wake: '${target}' matches multiple oracles`);
    for (const match of resolved.ambiguous.slice(0, 10)) console.error(`  maw tmux wake ${match.name}`);
    return 1;
  }
  if (!resolved.oracle) {
    console.error(`wake: repo not found for ${target}`);
    console.error("  next: maw oracle scan  # refresh oracles.json");
    console.error("  next: maw ls -a        # inspect live/sleeping sessions");
    console.error("");
    return 1;
  }
  const { oracle } = resolved;
  if (!oracle.localPath || !existsSync(oracle.localPath)) {
    console.error(`wake: checkout missing for ${oracle.name}: ${oracle.localPath ?? "(no path)"}`);
    console.error(`  ghq get -u ${oracle.org}/${oracle.repo}`);
    return 1;
  }

  const fleetSession = session ?? fleetSessionFor(oracle.name);
  if (!fleetSession) {
    console.error(`wake: ${oracle.name} has no fleet session yet, and the <NN>- prefix is maw-rs's to allocate`);
    console.error(`  maw-rs wake ${oracle.name}                     # let maw-rs register it`);
    console.error(`  maw tmux wake ${oracle.name} --session <NN>-${oracle.name}   # or name it yourself`);
    return 1;
  }

  const command = `MAW_SESSION_WINDOW=${oracle.name} ${engineCommand()}`;
  console.log(`${color("36", "→")} found ${color("1", oracle.name)} (${oracle.localPath})`);
  if (dryRun) {
    console.log(color("90", "dry-run — no tmux sessions/windows will be changed"));
    console.log(`${color("32", "+")} would wake window '${oracle.name}' in session '${fleetSession}'`);
    console.log(`  command: ${command}`);
    return 0;
  }

  const alive = liveSessions();
  if (!alive.includes(fleetSession)) {
    tmux(["new-session", "-d", "-s", fleetSession, "-n", oracle.name, "-c", oracle.localPath]);
  } else {
    const windows = tmux(["list-windows", "-t", fleetSession, "-F", "#{window_name}"])
      .split("\n").map(line => line.trim()).filter(Boolean);
    if (!windows.includes(oracle.name)) {
      tmux(["new-window", "-t", fleetSession, "-n", oracle.name, "-c", oracle.localPath]);
    }
  }
  // send-keys rather than passing the command to new-window: the pane survives
  // the engine exiting, which is what makes a woken oracle reusable.
  tmux(["send-keys", "-t", `${fleetSession}:${oracle.name}`, command, "Enter"]);
  console.log(`${color("32", "+")} woke window '${oracle.name}' in session '${fleetSession}'`);
  console.log(`  command: ${command}`);

  if (wantAttach) return attach([fleetSession]);
  console.log(`  maw tmux a ${fleetSession}`);
  return 0;
}
