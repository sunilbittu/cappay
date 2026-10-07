# CapPay — 3-minute pitch script

Target: ≤ 3:00, ~420 words spoken. This is the pitch, not the demo.

---

**(0:00–0:30) Founder–market fit — first 30 seconds**

I build agents that call tools, and agents retry. When a payment agent
calls `create_checkout` and gets a `504`, it cannot tell whether the
transfer landed or not. The safe move from the agent's perspective is to
try again — and that's how a merchant gets charged twice for one order.
I've hit this retry ambiguity in real agent workflows, and every fix I saw
assumed the agent and the merchant share a database. They don't.

**(0:30–1:10) The insight**

A `504` is not proof the payment failed. And a local flag — "I already
tried this order" — lives on one machine; it doesn't bind a different
wallet, a different agent run, or a different server. The only state both
sides already trust is the chain. So CapPay moves the idempotency key
on chain: the key is (merchant, order id), and it lives in a program-derived
order account created in the same transaction as the transfer. One
instruction path. If the transaction lands, the order is settled — there is
no pending state to misread. If anything retries that key — same wallet,
different wallet, different amount, different recipient — the chain rejects
it with `OrderAlreadySettled`, and the first bound values stay bound.

**(1:10–1:50) Product**

What you saw in the demo: settle order NL-10500 once — one transfer, one
explorer link, the order account exists. Retry the same id — the program
rejects it on chain. Fire two submits in the same breath — both try to
create the same account, only one transaction can land, exactly one
transfer. And a different order id is a different payment — we are not
trying to stop commerce, just double charges. The client holds one rule:
it won't send a second transaction while the first is unconfirmed. That
rule is politeness; the rejection is the protocol.

**(1:50–2:30) Market + viability**

The users are agent frameworks that can submit a transfer — every coding
agent, every payments agent, every checkout tool that retries on timeout.
The guard is an open-source program anyone can deploy or verify; there is
no token, no price sheet, and no invented traction — this starts at this
hackathon. It runs on Solana because the track prize is chain-agnostic but
Solana's extra pool rewards exactly this kind of small, verifiable program
— and because one-landing-transaction semantics is something Solana's
account model makes cheap to prove.

**(2:30–3:00) Honest close**

One disclosure: the demo program is upgradeable by the deployer. For a
devnet demo that's a feature — you can inspect and redeploy it yourself —
and for production it would be the first thing to remove. The guard is an
instruction, not a prompt: no agent reasoning, no free text, no trust.
One merchant, one order id, one transfer — enforced by the chain.
