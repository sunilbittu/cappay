# CapPay

**One merchant. One order id. One transfer.** An idempotency guard for agent
payments on Solana devnet, built for the Colosseum Crypto World's Fair
(Solana track).

An agent that pays will retry a checkout it is not sure succeeded — a `504`
after `create_checkout` proves nothing. If the agent and the merchant don't
share a database, a local flag doesn't bind the next wallet. CapPay makes the
**chain** the shared database: the idempotency key is `(merchant, order_id)`,
enforced by an on-chain order account. A retry — from any wallet, with any
amount — fails on chain with `OrderAlreadySettled`.

## How it works

- The order account is a PDA seeded `["order", merchant, order_id]`
  (`order_id` ≤ 32 bytes; longer ids are rejected by page validation and
  never sent).
- One instruction path: `settle_order` creates the PDA **and** transfers
  native SOL in the same transaction. If the transaction lands, the order is
  settled — there is no pending or in-flight state.
- A second instruction with the same key fails with `OrderAlreadySettled`,
  even if payer, amount, or recipient changed. The first values stay bound.
- Two submits racing on the same order id both try to create the same PDA:
  only one transaction can land. A different order id is a different payment.
- The demo program is upgradeable by the deployer. This is a devnet demo
  guard, not a production custody claim.

## Addresses (devnet)

| Role | Address |
|---|---|
| Program | `ETH1s4zbujtUuhM8WBoAErd8DpbYb4ea8e3wV9huV7fe` |
| Merchant (fixed, the idempotency scope) | `FCUUc1Mov2WijVEuAcyZajrTZLg3vhviCsfiD72NmRRu` |
| Recipient | `6W6q2VUcr1bbrKRoEh1a7E66bw8jbxDw9DpCruLHA5Aq` |
| Mint | native SOL |

## Replay it

1. **Get devnet SOL** for the wallet you'll connect with:
   [faucet.solana.com](https://faucet.solana.com) → `2 SOL` is plenty
   (fees + rent + the demo amount).
2. **Run the client:**

   ```sh
   npm install && npm run dev
   ```

   then open <http://localhost:7100/> in a browser with a Solana wallet
   (Backpack works; it must be on **devnet** — Settings → Preferences →
   enable Developer Mode, then select Devnet).

3. **Settle an order:** order id `NL-10500`, amount `0.01` → Submit →
   the result box shows the explorer link; the PDA status flips to
   "PDA exists".
4. **Retry the same order id** → the box shows
   `OrderAlreadySettled`. No second transfer (check the recipient balance).
5. **Change the order id** → a different order id is a different payment,
   and it settles once.
6. **Double-fire test** on a fresh order id → two submits sent together;
   one explorer link, one rejection, exactly one transfer.

## One-command setup (demo machine)

```sh
./scripts/setup.sh
```

Checks the Solana CLI, prints every address above, verifies the recipient
account exists, and confirms the payer covers fee + rent + demo amount.

## Repository layout

- `programs/cappay` — the Anchor program (Rust) with liteSVM tests:
  first settle lands, same-key retry fails, second wallet fails, two racing
  submits produce one transfer (`anchor test --skip-local-validator`).
- `app/` + `scripts/client/` — the one-page client (wallet connect, order id
  validation ≤ 32 bytes, explorer link, on-chain error display).
- `scripts/devnet-e2e.js` — CLI end-to-end check against devnet.
- `docs/PITCH.md` — the 3-minute pitch script.

## Honest scope

CapPay starts for this hackathon. No token, no price sheet, no custody, no
indexer, no pending state. Traction: none. Judges watch the videos; this
README exists so anyone can replay what the demo shows.
