# Security policy

## Scope

- **The GestureSeriesMarket contract** deployed on Arbitrum One at
  [`0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d`](https://arbiscan.io/address/0xDe5bC71e94B991265B2DfDCE0921245B70c51b4d),
  built from [`src/GestureSeriesMarket.sol`](src/GestureSeriesMarket.sol) in
  this repository (the tests reproduce the deployed bytecode exactly).
- **The web app** in [`frontend/`](frontend/), served at
  [chaoszero.com](https://chaoszero.com): anything that could make it show a
  wrong quote, submit a transaction other than the one the user saw, leak
  data, or run attacker-controlled script.
- The deployment and tooling in this repository (`script/`, `tools/`,
  `.github/`), where a flaw could compromise a build or a release.

Out of scope: the Cosmic Signature game and the CST token (third-party
contracts; report to their maintainers), wallets and RPC providers, and the
economic trade-offs documented under
[Design notes and trade-offs](README.md#design-notes-and-trade-offs) in the
README, such as trading on public live information or the capital-weighted fee
vote. Those are deliberate; a way to break one of their stated bounds is in
scope.

## Reporting a vulnerability

Report privately through GitHub:
**[Report a vulnerability](https://github.com/PredictionExplorer/ChaosZero/security/advisories/new)**
(the Security tab of this repository). Please do not open a public issue,
pull request or discussion.

A useful report includes:

- the affected component (contract function, page, script)
- the impact: who loses what, under which conditions
- a proof of concept; for the contract, a Foundry test against the suites in
  `test/` is ideal
- a suggested fix, if you have one

We will acknowledge the report, keep you informed while we investigate, and
credit you in the published advisory unless you prefer to stay anonymous.

## What a fix looks like

The contract has **no owner, no pause and no upgrade path**. Nobody, including
the maintainers, can change or halt the deployed code. A contract
vulnerability is therefore fixed by deploying a new, corrected contract,
pointing the frontend at it, and helping users move. The exits of the old
contract never close: liquidity providers can always withdraw
(`removeLiquidity`, `claimFees`), and outcome-token holders can redeem
complete sets before resolution (`redeemSets`) and claim after it (`claim`).
Frontend and tooling fixes ship as a normal pull request: every merge to `main`
deploys the frontend to production.

Because the deployed code cannot be patched, we coordinate disclosure with you
so that users are warned and a replacement is ready before details are
published.

## Testing guidelines

- Test against a local fork (`anvil --fork-url <Arbitrum One RPC>`) or the
  local sandbox (`script/DeployLocal.s.sol`), never against the live contract
  with real funds or other people's positions.
- Do not run denial-of-service tests against chaoszero.com or its RPC
  endpoints.
- Do not access or modify other users' data.

Research done in good faith within these guidelines is welcome.
