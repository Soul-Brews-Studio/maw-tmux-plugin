# maw-tmux-plugin

`maw ls` and the rest of the tmux fleet verbs, as a maw plugin. The tmux
counterpart to [maw-herdr-plugin](https://github.com/Soul-Brews-Studio/maw-herdr-plugin).

```bash
maw plugin install Soul-Brews-Studio/maw-tmux-plugin --root ~/.maw/plugins
maw default set tmux     # bare `maw ls` now routes here
maw tmux ls              # or address it explicitly
```

## Ported, not forwarded

The verbs are reimplemented in TypeScript from maw-rs (`core_impl/session_list_plan.rs`)
and maw-js (`commands/plugins/tmux/impl.ts`). No maw-rs binary is required at
runtime, and there is no shell-out to a legacy CLI.

Output is byte-identical to `maw-rs ls` for the modes implemented, including
colour codes and the JSON envelope, so switching costs nothing.

## Status

| verb | state |
|---|---|
| `ls`, `ls --json` | byte-identical to maw-rs |
| `a`/`attach` | live-session tier: exact, unique prefix, unique substring; `--print`, `--readonly` |
| `peek` | `--lines N` (default 30), `--history` |
| `ls -v` | not yet |
| `wake`, `run`, `kill`, `hey`, `bg`, `send-*`, `work` | not yet |

`a` resolves live sessions only. maw-rs additionally reaches sleeping
fleet-registry sessions, oracles, squads and remote nodes over ssh; this plugin
is local-only by design, so an unmatched target prints candidates rather than
guessing.

`peek` runs `capture-pane` through argv, never a shell. maw-js interpolated the
target into a shell string, so a target containing a quote reached `sh`; argv
arguments cannot be re-parsed, which removes that class of bug entirely.

The rules are maw-rs's own: pane age under 30s is `active`, under 300s `idle`,
otherwise `stale`; a session takes its liveliest pane's status; `NO_COLOR`
disables colour.
