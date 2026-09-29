## What and why

<!-- The change and the reason for it. Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran, tests you added, what you checked by hand. -->

## Checklist

- [ ] `src/` and the `[profile.default]` compiler settings are unchanged, or this is a planned redeploy (see [CONTRIBUTING.md](https://github.com/PredictionExplorer/ChaosZero/blob/main/CONTRIBUTING.md#the-one-rule-src-is-deployed))
- [ ] `make check` passes locally
- [ ] Gas snapshot refreshed with `make gas` if gas moved, and the reason is explained above
- [ ] Differential vectors regenerated with `make vectors` if the vector script or the math it exercises changed
- [ ] Tests cover the change, and docs (README, frontend/README.md, CONTRIBUTING.md) match it
