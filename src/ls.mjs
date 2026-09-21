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

// maw-rs hides infrastructure channel sessions from `ls` unless --channels.
// "discord-admin" is a real working session, not a channel, so it stays.
export function isChannelSession(session) {
  return session.endsWith("-discord") && !session.includes("discord-admin");
}

// maw-rs hides team sessions unless --teams.
export function isTeamSession(session) {
  return session.startsWith("team-") || session.includes(":team-") || session.includes("-team-");
}

// The window name inside "session:window.pane".
export function windowName(target) {
  const afterSession = target.includes(":") ? target.slice(target.indexOf(":") + 1) : target;
  const dot = afterSession.lastIndexOf(".");
  return dot === -1 ? afterSession : afterSession.slice(0, dot);
}

// A session's oracle is the first pane whose *window* is named "<name>-oracle".
// Session name and window name differ often enough that this must read windows.
export function oracleWindowName(panes) {
  for (const pane of panes) {
    const window = windowName(pane.target);
    if (window.endsWith("-oracle")) return window;
  }
  return undefined;
}

export function collectSessions(now = Math.floor(Date.now() / 1000), { channels = false, teams = false } = {}) {
  const panes = listPanes();
  const sessions = new Map();
  for (const pane of panes) {
    if (!channels && isChannelSession(pane.session)) continue;
    if (!teams && isTeamSession(pane.session)) continue;
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
  const lines = sessions.map(entry => {
    const oracle = oracleWindowName(entry.panes);
    const label = oracle ? ` · ${color("2", oracle)}` : "";
    const panes = color("2", `${entry.panes.length} pane${entry.panes.length === 1 ? "" : "s"}`);
    const agents = entry.panes.filter(pane => isAgentCommand(pane.command)).length;
    const agentCount = agents > 0
      ? `  ${color("94", `${agents} agent${agents === 1 ? "" : "s"}`)}`
      : "";
    return `  ${dot(entry.status)} ${color("36", entry.session)}${label}  ${panes}${agentCount}`;
  });
  lines.push("", `  ${color("2", "→ maw ls -v    full detail")}`);
  return `${lines.join("\n")}\n`;
}

export function renderJson(sessions) {
  return `${JSON.stringify({
    command: "ls",
    mode: "compact",
    scope: "local",
    json: true,
    // maw-rs emits "oracle" only when there is one, so the key must be absent
    // rather than null — a null would change the JSON shape for every session.
    sessions: sessions.map(entry => {
      const oracle = oracleWindowName(entry.panes);
      return {
        session: entry.session,
        status: entry.status,
        panes: entry.panes.length,
        agents: entry.panes.filter(pane => isAgentCommand(pane.command)).length,
        ...(oracle ? { oracle } : {}),
      };
    }),
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
  const sessions = collectSessions(Math.floor(Date.now() / 1000), {
    channels: args.includes("--channels"),
    teams: args.includes("--teams"),
  });
  process.stdout.write(json ? renderJson(sessions) : renderCompact(sessions));
  return 0;
}
