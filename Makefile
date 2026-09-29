# ChaosZero developer tasks. Run `make` (or `make help`) for the list.
#
# The same commands run in the git hooks (lefthook.yml) and in CI, so a green
# `make check` locally means a green pipeline. Works with the GNU make 3.81
# that ships with macOS. Pinned tool versions live in tools/versions.env.

SHELL := /bin/bash
.DEFAULT_GOAL := help
# forge commands share one build cache and lock; never run targets in parallel.
.NOTPARALLEL:

include tools/versions.env

FRONTEND := frontend
VECTORS := frontend/src/test/fixtures/contract-vectors.json

# Find Foundry where the official installer and tools/setup.sh put it, without
# overriding a forge that is already on PATH.
export PATH := $(PATH):$(HOME)/.foundry/bin

.PHONY: help setup doctor hooks foundry extras \
	fmt fmt-check fmt-contracts fmt-frontend fmt-check-contracts fmt-check-frontend \
	lint lint-contracts lint-frontend typecheck \
	build build-frontend dev \
	test test-contracts test-frontend test-e2e test-fork test-heavy \
	coverage coverage-contracts coverage-frontend \
	gas gas-check vectors vectors-check \
	analyze slither halmos mutation \
	check clean

##@ Getting started

help: ## Show this help
	@awk 'BEGIN { FS = ":.*## " } \
		/^##@/ { printf "\n%s\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*## / { printf "  make %-20s %s\n", $$1, $$2 }' $(firstword $(MAKEFILE_LIST))
	@echo

setup: ## Set up everything: submodules, frontend deps, git hooks; lists missing tools
	@tools/setup.sh

doctor: ## Compare installed tool versions with tools/versions.env
	@tools/setup.sh doctor

hooks: ## (Re)install the git hooks from lefthook.yml
	cd $(FRONTEND) && pnpm exec lefthook install

foundry: ## Install the pinned Foundry (and solc on Linux) from checksummed GitHub releases
	@tools/setup.sh foundry

extras: ## Install the pinned optional scanners (gitleaks, typos, actionlint, zizmor, slither, halmos)
	@tools/setup.sh extras

##@ Format and lint

fmt: fmt-contracts fmt-frontend ## Format everything in place

fmt-contracts: ## forge fmt
	forge fmt

fmt-frontend: ## Prettier, in place
	cd $(FRONTEND) && pnpm format

fmt-check: fmt-check-contracts fmt-check-frontend ## Fail if anything is unformatted

fmt-check-contracts: ## forge fmt --check
	forge fmt --check

fmt-check-frontend: ## Prettier --check
	cd $(FRONTEND) && pnpm format:check

lint: lint-contracts lint-frontend ## forge lint + ESLint

lint-contracts: ## forge lint
	forge lint

lint-frontend: ## ESLint
	cd $(FRONTEND) && pnpm lint

typecheck: ## TypeScript, no emit
	cd $(FRONTEND) && pnpm typecheck

##@ Build and run

build: ## Compile the contracts and report sizes (forge build --sizes)
	forge build --sizes

build-frontend: ## Production build of the frontend (fetches Google Fonts, needs network)
	cd $(FRONTEND) && pnpm build

dev: ## Frontend dev server on http://localhost:3000
	cd $(FRONTEND) && pnpm dev

##@ Test

test: test-contracts test-frontend ## Contract and frontend test suites

test-contracts: ## Unit, fuzz and invariant tests (fork tests skip without ARBITRUM_RPC_URL)
	forge test

test-frontend: ## Vitest: unit, property, differential and component tests
	cd $(FRONTEND) && pnpm test

test-e2e: ## Playwright end to end against a local anvil deployment
	tools/e2e.sh

test-fork: ## Fork tests against Arbitrum One (needs ARBITRUM_RPC_URL)
	@if [ -z "$${ARBITRUM_RPC_URL:-}" ]; then \
		echo "ARBITRUM_RPC_URL is not set; export an Arbitrum One RPC URL first." >&2; \
		exit 1; \
	fi
	forge test --match-contract Fork

test-heavy: ## Long fuzzing campaign (FOUNDRY_PROFILE=heavy)
	FOUNDRY_PROFILE=heavy forge test

coverage: coverage-contracts coverage-frontend ## Coverage for both, enforcing thresholds

coverage-contracts: ## Contract coverage with thresholds (tools/coverage.sh)
	tools/coverage.sh

coverage-frontend: ## Frontend coverage with thresholds (vitest)
	cd $(FRONTEND) && pnpm test:coverage

##@ Snapshots and vectors

gas: ## Refresh the gas snapshot (snapshots/GasBenchmarksTest.json)
	forge test --match-contract GasBenchmarksTest

gas-check: ## Fail if gas use drifted from the committed snapshot
	FORGE_SNAPSHOT_CHECK=true forge test --match-contract GasBenchmarksTest

vectors: ## Regenerate the frontend's differential test vectors from the contract
	forge script script/GenerateVectors.s.sol --tc GenerateVectors

vectors-check: vectors ## Fail if the committed vectors differ from the contract's output
	@git diff --exit-code -- $(VECTORS) || { \
		echo "$(VECTORS) is stale: review the diff above and commit the regenerated file." >&2; \
		exit 1; \
	}

##@ Analysis

analyze: slither halmos ## Static analysis and symbolic tests

slither: ## Slither; fails on any untriaged finding
	slither . --config-file slither.config.json

halmos: ## Symbolic tests (tools/analysis/halmos.sh)
	tools/analysis/halmos.sh

mutation: ## Mutation testing, slow; runs weekly in CI (tools/analysis/mutation.sh)
	tools/analysis/mutation.sh

##@ All together

check: fmt-check lint build test coverage vectors-check gas-check ## Everything CI's offline gates run, in order, fail-fast

clean: ## Remove build output and caches (contracts and frontend)
	forge clean
	rm -rf $(FRONTEND)/.next $(FRONTEND)/coverage coverage lcov.info
