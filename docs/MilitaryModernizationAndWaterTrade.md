# Military modernization and water trade

Military buildings automatically upgrade to the highest supported age unlocked
by their current owner's completed research. Barracks use warfare equipment
research; ports use naval construction research. Archery ranges, stables, siege
workshops, towers, airstrips, equipment producers and modern defenses use their
existing building-specific technology gates. Entering an age alone does not
upgrade them. No building changes type when its line ends.

The rule also applies when construction finishes or ownership changes. It
preserves the fraction of remaining health, does not repair destroyed buildings,
and leaves attached walls, existing units and economic buildings unchanged.
Bronze Age and later technologies that unlock military infrastructure cost twice
their previous gold price. Research time and technology-speed scaling retain
their existing rules; there is no per-building charge.

Water deliveries pay cargo base value times the existing ownership/alliance
multiplier times **1% per tile between the loading port and destination port**,
capped at 200%. Distance rounds down to whole tiles. There is no minimum base
payout, and an inland factory does not contribute distance. Distance is direct
endpoint separation rather than traveled distance, so detours and multi-stop
loops cannot inflate a delivery's quote. Land trade and captured-cargo settlement
retain their existing rules.

For 10 Stone Age goods (50 gold base value each) delivered to a foreign port,
two tiles pay 25 gold, 20 tiles pay 250 gold, and 100 tiles pay 1,250 gold.
These are initial balance values. A five-minute regression uses unlimited goods
to verify that adjacent foreign ports earn less than a distant route.
