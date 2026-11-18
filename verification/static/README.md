# V4 contract static analysis

The V4 workflow runs Slither on the game-funded market and its read helper using the default Foundry production profile. It compares every high and medium finding with the individually reviewed entries in `reviewed.json`. An added, removed, duplicated or relocated finding fails the gate. Slither includes source locations in some fingerprints, so an edit that moves a line can require review. The rationale for the existing findings is in [Security scope](../../SECURITY.md#v4-static-review).

Use Python 3.13, Foundry 1.7.1 and initialized submodules. From the repository root, run

```sh
python3.13 -m venv .local/static-venv
.local/static-venv/bin/pip install --require-hashes --only-binary=:all: --no-deps -r verification/static/requirements.txt
.local/static-venv/bin/pip check
python3.13 -m unittest discover -s verification/static
.local/static-venv/bin/python verification/static/check.py
```

Inspect `.local/static/results.json` for the full detector description and locations. Before updating a fingerprint, review the affected control flow and update the security rationale if it has changed. The compiler writes temporary ASTs to an isolated directory, leaving normal build artifacts intact.
