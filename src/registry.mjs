import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The two local registries maw-rs consults when a target is not a live tmux
// session. Reading them is what turns a dead end into a runnable command.
//
//   ~/.maw/oracles.json   every known oracle checkout
//   ~/.maw/fleet/*.json   sessions maw wake has registered, with their windows

function mawHome() {
  return process.env.MAW_HOME || join(homedir(), ".maw");
}

export function readOracles() {
  const path = join(mawHome(), "oracles.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed.oracles;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(row => row && typeof row.name === "string")
      .map(row => ({ name: row.name, org: row.org, repo: row.repo, localPath: row.local_path }));
  } catch { return []; }
}

export function readFleet() {
  const dir = join(mawHome(), "fleet");
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const file of readdirSync(dir)) {
    // maw-rs disables an entry by renaming it, not deleting it.
    if (!file.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (entry && typeof entry.name === "string") {
        entries.push({ name: entry.name, windows: Array.isArray(entry.windows) ? entry.windows : [] });
      }
    } catch { /* a malformed fleet file is skipped, never fatal */ }
  }
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

// Exact beats prefix beats substring, and the tier is reported so the caller
// can label the match the way maw-rs does.
function rank(query, candidates, nameOf) {
  const q = query.trim().toLowerCase();
  const exact = candidates.filter(c => nameOf(c).toLowerCase() === q);
  if (exact.length) return { tier: "Exact", matches: exact };
  const prefix = candidates.filter(c => nameOf(c).toLowerCase().startsWith(q));
  if (prefix.length) return { tier: "Prefix", matches: prefix };
  const substring = candidates.filter(c => nameOf(c).toLowerCase().includes(q));
  if (substring.length) return { tier: "Registry", matches: substring };
  return { tier: undefined, matches: [] };
}

const TIER_ORDER = ["Exact", "Prefix", "Registry"];

export function suggestionsFor(target) {
  const oracle = rank(target, readOracles(), row => row.name);
  const oracleRows = oracle.matches.map(match => ({
    kind: "oracle",
    name: match.name,
    tier: oracle.tier,
    command: match.org && match.repo
      ? `maw wake ${target} --attach --repo ${match.org}/${match.repo}`
      : `maw wake ${target} --attach`,
  }));

  // Fleet sessions match on their window names, which is how a bare oracle name
  // reaches a numbered session like "70-beta".
  const query = target.trim().toLowerCase();
  const sessionRows = readFleet()
    .filter(entry => entry.windows.some(window =>
      typeof window?.name === "string" && window.name.toLowerCase().includes(query)))
    .map(entry => ({
      kind: "session",
      name: entry.name,
      tier: "Registry",
      command: `maw wake ${target} --attach --session ${entry.name}`,
    }));

  // Only the best tier is offered. An exact oracle and the numbered session it
  // sleeps in are the same answer twice, and maw-rs prints just the oracle.
  const rows = [...oracleRows, ...sessionRows];
  const best = TIER_ORDER.find(tier => rows.some(row => row.tier === tier));
  return best ? rows.filter(row => row.tier === best) : [];
}

// maw-rs's exact dead-end rendering, down to the three spaces before the arrow.
export function renderSuggestions(verb, target, reason, rows) {
  if (!rows.length) return `${verb}: '${target}' not found`;
  const lines = [`${verb}: '${target}' ${reason}. Found nearby:`];
  rows.forEach((row, index) => {
    lines.push(`  ${index + 1}. ${row.kind} ${row.name} (${row.tier})   → ${row.command}`);
  });
  return lines.join("\n");
}
