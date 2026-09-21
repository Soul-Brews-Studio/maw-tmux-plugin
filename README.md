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
| `ls -v` | not yet |
| `a`, `wake`, `run`, `kill`, `hey`, `bg`, `send-*` | not yet |

The rules are maw-rs's own: pane age under 30s is `active`, under 300s `idle`,
otherwise `stale`; a session takes its liveliest pane's status; `NO_COLOR`
disables colour.
