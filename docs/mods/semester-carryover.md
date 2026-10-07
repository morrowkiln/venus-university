# Mod continuity between semesters

Continue a completed semester normally. Its selected ending save supplies the next opening
save; starting an unrelated new game still starts empty. Existing finished saves work without
a migration script. A semester already started by an older build cannot recover records that
were previously discarded: continue again from its previous semester's ending save to include them.

| Mod | What continues |
| --- | --- |
| Story Memory | Facts, player corrections, hidden records and saved encounter recaps; private knowledge and timeline tags remain intact. |
| Meanwhile | Previously generated conversations, including ones with characters who graduate. Unwatched encounter offers are not invented or generated during carryover. |
| Breakthrough | Per-character spirit and actual saved outcomes. Daily settlement guards reset so the new day zero can earn spirit. An interrupted activation is refunded under the normal recovery rule, never replayed as a new advantage. |
| Plot Twist | The active text, still editable or clearable through the existing menu. |

Turning a mod off retains its data, but does not enable its prompts or UI. Meanwhile remains
spectator fiction, not knowledge awarded to the player or facts inserted into Story Memory.
Breakthrough does not require Story Memory; its own bounded outcome context still works alone.

## Implementation

`termCarry.ts` calls the pure `carryModState` adapter and `carriedOpening` installs the optional
fields on the new save. `newGame.ts` supplies the outgoing roster for archived names.
`termOrigin.ts` records the zero-based original term and original day; the UI shows semesters
starting at 1. Dates subtract the same spring/fall gap used by native memories, including on
second and later continuations. Archived recaps live in `exStoryMemory.pastEncounters`, not in
active `history`. Original recaps, corrections and hidden flags remain distinct.

Fact and encounter IDs are qualified once by their original semester. Fact supersession,
edits and hidden references follow those IDs; old extraction batches cannot replace new-term
facts. Breakthrough outcomes lose transcript offsets because the new scene has a different
transcript. Meanwhile caches retain speaker names so graduates' replays remain readable.

SQLite is still a disposable index. The next semester rebuilds it from its own save snapshot;
no database file or another playthrough's records are copied. Negative historical dates are
accepted at recall validation, while the current request's day must remain nonnegative.
Retrieval limits and prompt budgets have not increased: up to 3,000 facts, bounded recap
snapshots, 50 Meanwhile replays, six saved Breakthrough outcomes per character (latest three
eligible for its prompt). These are retention caps, not a promise of unlimited history.

See `test/modTermCarry.test.ts` for successive-semester, save/load, SQLite/fallback, hidden/edit,
graduated-character and independent-switch coverage.
