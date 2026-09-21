import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmux } from "./tmux.mjs";

// Target resolution ported from maw-js commands/plugins/tmux/impl.ts
// (resolveTmuxTarget). Local tiers only: pane id, session:w.p, team agent,
// live session, bare name. maw-js also resolves against its fleet registry
// (tier 3.5) via loadFleetEntries + the core matcher; that is a separate
// dependency tree this plugin deliberately does not carry.

const TEAMS_DIR = join(homedir(), ".claude/teams");

export function liveSessions() {
  const raw = tmux(["list-sessions", "-F", "#{session_name}"]);
  return raw.split("\n").map(line => line.trim()).filter(Boolean).sort();
}

// Exact, then unique prefix, then unique substring — the order maw-rs and
// maw-js both settle on. Ambiguity is reported, never guessed.
export function matchLive(query, alive) {
  if (alive.includes(query)) return { kind: "live", session: query };
  for (const pool of [alive.filter(n => n.startsWith(query)), alive.filter(n => n.includes(query))]) {
    if (pool.length === 1) return { kind: "live", session: pool[0] };
    if (pool.length > 1) return { kind: "ambiguous", candidates: pool };
  }
  return { kind: "not-found", candidates: alive };
}

function teamAgentPane(target) {
  if (!existsSync(TEAMS_DIR)) return undefined;
  for (const dir of readdirSync(TEAMS_DIR)) {
    const config = join(TEAMS_DIR, dir, "config.json");
    if (!existsSync(config)) continue;
    try {
      const team = JSON.parse(readFileSync(config, "utf8"));
      for (const member of team.members ?? []) {
        // "in-process" agents have no pane to look at — not a tmux target.
        if (member?.name === target && member?.tmuxPaneId && member.tmuxPaneId !== "" && member.tmuxPaneId !== "in-process") {
          return { resolved: member.tmuxPaneId, source: `team-agent (${dir})` };
        }
      }
    } catch { /* a malformed team config is skipped, never fatal */ }
  }
  return undefined;
}

export function resolveTmuxTarget(target) {
  if (/^%\d+$/.test(target)) return { resolved: target, source: "pane-id" };
  if (/^[\w.-]+:\d+\.\d+$/.test(target)) return { resolved: target, source: "session:w.p" };

  const team = teamAgentPane(target);
  if (team) return team;

  let alive = [];
  try { alive = liveSessions(); } catch { /* no server: fall through to bare name */ }
  if (alive.length > 0) {
    const match = matchLive(target.split(":")[0], alive);
    if (match.kind === "live") return { resolved: match.session, source: `live-session (${match.session})` };
    if (match.kind === "ambiguous") return { ambiguous: match.candidates };
  }

  // Let tmux itself resolve a bare name to its current/first pane.
  return { resolved: target, source: "session-name" };
}
