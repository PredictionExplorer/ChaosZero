"""Exercise the repository rules against synthetic data without logging values."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main(executable):
    # The same 32 bytes are public data in one context and a credential in another.
    sample = hashlib.sha256(b"Chaos Zero disposable scanner fixture").hexdigest()
    cases = {
        "config.env": (f'DEPLOYER_PRIVATE_KEY="0x{sample}"', "evm-private-key"),
        "command.sh": (f"forge script --private-key {sample}", "evm-private-key"),
        "rpc.env": (f"RPC=https://arb-mainnet.g.alchemy.com/v2/{sample}", "rpc-provider-url-key"),
        "ankr.env": (f"RPC=https://rpc.ankr.com/arbitrum/{sample}", "rpc-provider-url-key"),
        "block.txt": (f"blockHash=0x{sample}", None),
        "public.env": ("RPC=https://arb1.arbitrum.io/rpc", None),
    }
    with tempfile.TemporaryDirectory() as directory:
        for name, (content, _) in cases.items():
            (Path(directory) / name).write_text(content + "\n")
        scan = subprocess.run(
            [
                executable, "dir", "--config", str(ROOT / ".gitleaks.toml"),
                "--redact=100", "--no-banner", "--ignore-gitleaks-allow",
                "--gitleaks-ignore-path", "/dev/null", "--report-format", "json",
                "--report-path", "-", directory,
            ],
            stdout=subprocess.PIPE,
            check=False,
        )
    if scan.returncode != 1:
        raise SystemExit(f"Expected the scanner to detect synthetic credentials, got {scan.returncode}")
    findings = {(Path(item["File"]).name, item["RuleID"]) for item in json.loads(scan.stdout)}
    for name, (_, rule) in cases.items():
        if rule and (name, rule) not in findings:
            raise SystemExit(f"{rule} missed {name}")
        if not rule and any(file == name for file, _ in findings):
            raise SystemExit(f"Public fixture {name} produced a credential finding")


if __name__ == "__main__":
    main(sys.argv[1])
