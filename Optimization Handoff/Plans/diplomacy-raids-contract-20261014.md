# Prototype diplomacy implementation contract

Branch: `1.5.7-10hz-prototype`. Implement the diplomacy stage of `.codex/1.5 Update Plans/Nomad Factions/PLAN.md`; no nomad content/spawning, group navigation redesign, geometry redesign, or tick-rate change. Tick rate remains 20 Hz.

New normal matches use a recorded `raids-v1` diplomacy rule version. Old checkpoints/replays with no recorded version retain legacy semantics. Performance comparisons explicitly opt the captured fixture into the new rules and distinguish old-state continuation from new-match behavioral development.

Authority belongs to Diplomacy: neutral/allied/war relationship, directional embargo (presented as Raid), bilateral combat permission, war-only building attack/capture, peace protection, exemption preferences, war initiator/cause, offers and cooldowns. PairRelations is a projection, not a second permission authority. Threat bookkeeping cannot create permissions.

Human actions remain automatic: actual movement into non-allied owned land establishes war, allied passage does not, successful eligible trade theft establishes/refreshes a directional raid. Incidental capture-radius overlap does not establish war. AI neutral transit/pursuit cannot establish war; invasion requires an explicit feasible objective. Raids allow unit combat but no enemy ownership transfer or deliberate building damage. Unclaimed land remains capturable without war. Every capture path, including coastal expansion, enclosed absorption and defeat transfers, must respect this distinction.

User-confirmed edge rules, October 14:

- Don't embargo suppresses automatic peacetime theft, leaves an existing raid to expire normally, and does not suppress wartime theft.
- Accepted peace ends war and raids, establishes one minute of protection, and blocks new territorial entry during protection. Exiting already occupied foreign territory is allowed.
- Ownership changes beneath stationary units do not declare war. New physical territorial entry does.
- Already-fired attacks resolve across peace/alliance transitions with their launch permissions; new attacks require current permissions. Preserve existing strategic-blast collateral semantics.
- Peace proposals: five-minute per-pair cooldown; no more than one AI peace proposal to a human per 30 seconds; no repeated proposal absent meaningful changes. Persist these limits and offer state.
- Expansion is preferred, retaliation is allowed, and personalities may make profitable exceptions. The first implementation uses maintained passable unclaimed-frontier edges: while expanding without observed aggression, optional invasions require at least 1.6x combat advantage for conquerors and 2.5x for other personalities. These are initial balance thresholds, not proven final tuning. A committed land invasion also needs force readiness and an exact prospective route before declaring war. This does not add a naval transport expedition planner.

Permission revisions change on effective pair-permission changes, not offer metadata or refreshed timestamps with unchanged permission. New state must be carried by checkpoints, replay, snapshots, late joins and schema validation. UI and command authority expose the same actions, including tribes where peace/exemption is meaningful; preserve existing alliance eligibility restrictions.

User-confirmed movement policy: neutral squads allow passage like friendly squads. Hard root/formation collision, placement, landing and detour constraints apply only to current war/raid opponents. Existing bounded friendly soft-spacing preferences remain. Terrain, fortifications and territorial-entry permissions remain separate constraints. Legacy matches retain their original non-allied hostility behavior.

Validation: permission matrix, human land/sea interception and territorial entry, AI neutral boundaries and planned invasions, peace/expiry/exemptions, damage/capture paths, launch-time projectiles, restoration and multiplayer codec/command validation, UI parity, and full regression checks. Profile paired baseline/new-rules runs after behavior tests; don't claim canonical equality between different gameplay rules or extrapolate local CPU timing to ARM.
