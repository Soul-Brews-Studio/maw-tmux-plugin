import { spawnSync } from "node:child_process";
import { TmuxUnreachable } from "./tmux.mjs";
import { liveSessions, matchLive } from "./resolve.mjs";

// Ported from maw-rs core_impl/attach.rs, local tier only. maw-rs also resolves
// sleeping fleet-registry sessions, oracles and squads (tiers 2-3, including
// remote attach over ssh); this plugin has no fleet registry, so an unmatched
// target is a dead end with a hint rather than a wrong guess.

// maw-rs matches on the part before ':' so "mawjs:3" still resolves the session.
export function resolveTarget(target, alive) {
  return matchLive(target.split(":")[0], alive);
}

// Inside tmux, attaching a second client to the same server detaches nothing
// and confuses the terminal — maw-rs switches the current client instead.
export function decideAction(session, { readonly = false, inTmux = false } = {}) {
  if (readonly) return { verb: "attach", args: ["attach", "-r", "-t", session] };
  if (inTmux) return { verb: "switch-client", args: ["switch-client", "-t", session] };
  return { verb: "attach", args: ["attach", "-t", session] };
}

// maw-rs renders the plan from its *port* args, not the exec args: the printed
// command is the attach form even when running it would switch-client. Keeping
// that, so a printed plan stays copy-pasteable from outside tmux.
export function planArgs(session, readonly) {
  return readonly ? ["attach", "-r", "-t", session] : ["attach", "-t", session];
}

export function renderPlanText(target, session, readonly) {
  return `Run: tmux ${planArgs(session, readonly).join(" ")}\n  resolved: ${target} → ${session}\n  detach with: Ctrl-b d`;
}

export function renderPlanJSON(target, session, readonly) {
  return JSON.stringify({
    command: "attach",
    alias: "a",
    target,
    session,
    action: "print",
    tmuxArgs: planArgs(session, readonly),
  });
}

const USAGE = `usage: maw tmux a <target> [--print] [--plan-json] [--readonly|-r]
       maw tmux attach <target> [--print] [--plan-json] [--readonly|-r]`;

export function attach(argv) {
  let target;
  let print = false;
  let readonly = false;
  let planJson = false;
  for (const arg of argv) {
    if (arg === "--print") print = true;
    else if (arg === "--plan-json") planJson = true;
    else if (arg === "--readonly" || arg === "--read-only" || arg === "-r") readonly = true;
    else if (arg.startsWith("-")) {
      console.error(`maw tmux a: unknown option "${arg}"`);
      console.error(`  ${USAGE.split("\n")[0].replace("usage: ", "")}`);
      return 2;
    } else if (target === undefined) target = arg;
    else {
      console.error(`maw tmux a: unexpected extra argument "${arg}"`);
      console.error(`  maw tmux a ${target}`);
      return 2;
    }
  }
  if (!target) {
    console.error("maw tmux a: a target is required");
    console.error(USAGE);
    console.error("  maw tmux ls          list live sessions to pick a target from");
    return 2;
  }

  const alive = liveSessions();
  const resolved = resolveTarget(target, alive);
  if (resolved.kind === "not-found") {
    console.error(`maw tmux a: "${target}" matches no live session`);
    if (resolved.candidates.length === 0) {
      console.error(`  tmux new-session -d -s ${target}`);
    } else {
      for (const name of resolved.candidates.slice(0, 10)) console.error(`  maw tmux a ${name}`);
    }
    return 1;
  }
  if (resolved.kind === "ambiguous") {
    console.error(`maw tmux a: "${target}" matches multiple sessions`);
    for (const name of resolved.candidates.slice(0, 10)) console.error(`  maw tmux a ${name}`);
    return 1;
  }

  if (planJson) {
    console.log(renderPlanJSON(target, resolved.session, readonly));
    return 0;
  }
  if (print) {
    console.log(renderPlanText(target, resolved.session, readonly));
    return 0;
  }
  const action = decideAction(resolved.session, { readonly, inTmux: process.env.TMUX !== undefined });
  // attach and switch-client both need the real terminal, so inherit stdio
  // rather than capturing it the way tmux() does for list commands.
  const result = spawnSync("tmux", action.args, { stdio: "inherit" });
  if (result.error) {
    throw new TmuxUnreachable(
      result.error.code === "ENOENT" ? "tmux is not installed" : result.error.message,
    );
  }
  return result.status ?? 0;
}
