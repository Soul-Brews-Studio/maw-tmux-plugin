import { listPanes } from "./tmux.mjs";

// Ported from maw-rs core_impl/session_list_plan.rs so `maw ls` keeps meaning
// what it has always meant. Thresholds, rollup and glyphs are its rules, not
// new ones.
const DOTS = {
  frozen: ["33", "⚠"],
  active: ["32", "●"],
  idle: ["33", "◐"],
  stale: ["31", "◌"],
};
const UNKNOWN_DOT = ["90", "·"];

export function paneStatus(ageSeconds) {
  if (ageSeconds === undefined) return "unknown";
  if (ageSeconds < 30) return "active";
  if (ageSeconds < 300) return "idle";
  return "stale";
}

// A session is as alive as its liveliest pane.
export function bestStatus(statuses) {
  for (const rank of ["active", "idle", "stale"]) {
    if (statuses.includes(rank)) return rank;
  }
  return "unknown";
}

const color = (code, value) =>
  process.env.NO_COLOR !== undefined ? value : `\u001b[${code}m${value}\u001b[0m`;

const dot = status => {
  const [code, glyph] = DOTS[status] ?? UNKNOWN_DOT;
  return color(code, glyph);
};

export function collectSessions(now = Math.floor(Date.now() / 1000)) {
  const panes = listPanes();
  const sessions = new Map();
  for (const pane of panes) {
    const age = pane.activity === undefined ? undefined : Math.max(0, now - pane.activity);
    const status = paneStatus(age);
    if (!sessions.has(pane.session)) sessions.set(pane.session, { session: pane.session, panes: [], statuses: [] });
    const entry = sessions.get(pane.session);
    entry.panes.push({ ...pane, age, status });
    entry.statuses.push(status);
  }
  return [...sessions.values()]
    .map(entry => ({ ...entry, status: bestStatus(entry.statuses) }))
    .sort((a, b) => a.session < b.session ? -1 : a.session > b.session ? 1 : 0);
}

export function renderCompact(sessions) {
  if (!sessions.length) return "no active sessions\n";
  const lines = sessions.map(entry =>
    `  ${dot(entry.status)} ${color("36", entry.session)}  ${color("2", `${entry.panes.length} pane${entry.panes.length === 1 ? "" : "s"}`)}`);
  lines.push("", `  ${color("2", "→ maw ls -v    full detail")}`);
  return `${lines.join("\n")}\n`;
}

export function renderJson(sessions) {
  return `${JSON.stringify({
    command: "ls",
    mode: "compact",
    scope: "local",
    json: true,
    sessions: sessions.map(entry => ({
      session: entry.session,
      status: entry.status,
      panes: entry.panes.length,
      agents: entry.panes.filter(pane => isAgentCommand(pane.command)).length,
    })),
  })}\n`;
}

// maw-rs shares one predicate across every site that counts agents; this is the
// same set of command names.
export function isAgentCommand(command) {
  return ["claude", "codex", "gemini", "opencode", "aider", "amp", "cursor-agent", "crush", "omp", "omx"]
    .includes((command || "").trim().toLowerCase());
}

export function ls(args) {
  const json = args.includes("--json");
  const sessions = collectSessions();
  process.stdout.write(json ? renderJson(sessions) : renderCompact(sessions));
  return 0;
}
