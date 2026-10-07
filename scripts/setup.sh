#!/usr/bin/env bash
# CapPay one-command demo setup: verifies toolchain, prints addresses,
# checks recipient exists and payer covers fee + rent + demo amount.
set -euo pipefail

cd "$(dirname "$0")/.."

# Solana CLI / Anchor are commonly installed outside the default PATH.
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

PROGRAM_ID="ETH1s4zbujtUuhM8WBoAErd8DpbYb4ea8e3wV9huV7fe"
MERCHANT="FCUUc1Mov2WijVEuAcyZajrTZLg3vhviCsfiD72NmRRu"
RECIPIENT="6W6q2VUcr1bbrKRoEh1a7E66bw8jbxDw9DpCruLHA5Aq"
DEMO_AMOUNT_SOL=0.01

echo "== CapPay demo setup =="
echo

if ! command -v solana >/dev/null 2>&1; then
  echo "ERROR: Solana CLI not found. Install from https://docs.solana.com/cli"
  exit 1
fi

solana config set --url devnet >/dev/null
echo "cluster:   $(solana config get | grep 'RPC URL' | awk '{print $3}')"
echo "program:   $PROGRAM_ID"
echo "merchant:  $MERCHANT"
echo "recipient: $RECIPIENT"
echo

if solana account "$RECIPIENT" >/dev/null 2>&1; then
  echo "recipient account: exists ($(solana balance "$RECIPIENT"))"
else
  echo "ERROR: recipient account does not exist on devnet."
  exit 1
fi

PAYER=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')
echo
echo "payer:     $PAYER"
echo "balance:   $BALANCE SOL"
if python3 -c "exit(0 if float('$BALANCE') >= 0.05 else 1)"; then
  echo "payer covers fee + rent + demo amount ($DEMO_AMOUNT_SOL SOL): yes"
else
  echo "WARNING: low balance. Fund with https://faucet.solana.com (needs ~0.05 SOL)"
fi

echo
echo "Next: npm install && npm run dev, then open http://localhost:7100/"
