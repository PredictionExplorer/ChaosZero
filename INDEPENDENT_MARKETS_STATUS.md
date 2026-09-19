# Independent-market update

Branch: `codex/independent-eight-markets`. The local launcher now deploys the
independent engine with fake CST. No public deployment or main-branch merge.

Implemented:

- Eight independent weighted binary pools, funded equally in one transaction.
- Ordinary ERC-1155 positions, buys/sells, transfers and complete-set split/merge.
- Winning positions pay exactly 1 CST after full cycle closure.
- Settlement reserves every outstanding winning claim in a separate vault,
  empties the old active pools, and credits only surplus to future funding.
- The next first funding transaction includes the previous funded cycle's carry
  before trading starts. Late claims cannot affect new pools. Skipped game
  cycles require no catch-up loop; sufficient carry can start a market with no
  new CST.
- Starting odds use the preceding cycle's time-weighted recorded prices over
  40–60% of its canonical duration, with explicit missing-history fallback.
- The browser separates active pool collateral, unpaid claims and carry, and
  supports recovery of old positions when the result source is unavailable.

No winning-holder bonus or sponsor withdrawal rights. Matching YES/NO pairs
return their original CST without capturing a share of the surplus. Voluntary
additional gifts can move prices; automatic carry is applied only at startup.
Numerical capacity limits retain exceptional excess carry for later cycles.

The complete repository gate, both production configurations and the integrated
local browser lifecycle passed. Extended campaigns passed 2,800,000 fuzz cases
and 1,441,792 stateful actions without failures. Results and reproduction
commands are recorded in [VALIDATION.md](VALIDATION.md). The prior shared engine
and its tests remain as regression coverage.

The live game's eight-question result adapter is still future work. Local
validation does not authorize using the simulator with real CST.
