import { spawnSync } from "node:child_process";

// The exact format maw-rs asks tmux for, so panes parse to the same fields.
export const PANE_FORMAT =
  "#{pane_id}|||#{pane_current_command}|||#{session_name}:#{window_name}.#{pane_index}|||#{pane_title}|||#{pane_pid}|||#{pane_current_path}|||#{window_activity}";

export class TmuxUnreachable extends Error {}

export function tmux(args) {
  const result = spawnSync("tmux", args, { encoding: "utf8" });
  if (result.error) {
    throw new TmuxUnreachable(result.error.code === "ENOENT" ? "tmux is not installed" : result.error.message);
  }
  if (result.status !== 0) {
    throw new TmuxUnreachable((result.stderr || "").trim() || `tmux exited with status ${result.status}`);
  }
  return result.stdout;
}

// A connect failure must never look like "tmux is running and empty": those are
// different answers, and collapsing them is a false negative maw-rs calls out
// explicitly.
export function listPanes() {
  const raw = tmux(["list-panes", "-a", "-F", PANE_FORMAT]);
  const panes = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [id, command, target, title, pid, path, activity] = line.split("|||");
    if (!id || !target) continue;
    const session = target.slice(0, target.indexOf(":"));
    panes.push({
      id,
      command: command ?? "",
      target,
      session,
      window: target.slice(target.indexOf(":") + 1),
      title: title ?? "",
      pid: pid ?? "",
      path: path ?? "",
      activity: /^\d+$/.test(activity ?? "") ? Number(activity) : undefined,
    });
  }
  return panes;
}
