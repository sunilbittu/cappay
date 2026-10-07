import * as web3 from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

const PROGRAM_ID = new web3.PublicKey("ETH1s4zbujtUuhM8WBoAErd8DpbYb4ea8e3wV9huV7fe");
const MERCHANT = new web3.PublicKey("FCUUc1Mov2WijVEuAcyZajrTZLg3vhviCsfiD72NmRRu");
const RECIPIENT = new web3.PublicKey("6W6q2VUcr1bbrKRoEh1a7E66bw8jbxDw9DpCruLHA5Aq");
const CHAIN = "solana:devnet";

function u8concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return out;
}
const RPC = "https://api.devnet.solana.com";
const ORDER_ID_MAX_BYTES = 32;

const conn = new web3.Connection(RPC, "confirmed");

// ---- Wallet Standard -------------------------------------------------------
// Two registration paths:
// 1. Modern: window.navigator.wallets (may inject after page load -> poll).
// 2. Backpack 0.10.x: CustomEvent protocol ("wallet-standard:register-wallet").
let walletsApi = null;
let eventWallet = null;
let connected = null; // { wallet, account }

function acceptWallet(w) {
  if (w && w.features && w.features["standard:connect"]) eventWallet = w;
  diag(`BP register-wallet fired (name=${w && w.name}); stored=${!!eventWallet}`);
}

// Backpack's CustomEvent protocol: listen, then signal app-ready.
const BP_REGISTER_EVENT = "wallet-standard:register-wallet";
window.addEventListener(BP_REGISTER_EVENT, (e) => {
  try { e.detail({ register: acceptWallet }); } catch (err) { diag("BP register error: " + err.message); }
});
window.dispatchEvent(new CustomEvent("wallet-standard:app-ready"));

// ---- On-page diagnostics (so a screenshot tells us everything) -------------
const diagLines = [];
function diag(msg) {
  diagLines.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  const el = document.getElementById("diag");
  if (el) el.textContent = diagLines.slice(-6).join("\n");
}
window.addEventListener("error", (e) => diag("JS ERROR: " + e.message));

function registerWallets() {
  if (walletsApi || !window.navigator.wallets) return false;
  window.navigator.wallets.add({ version: "1.0.0" }, (api) => {
    walletsApi = api;
  });
  return true;
}

registerWallets();
const walletsPoll = setInterval(() => {
  if (registerWallets()) clearInterval(walletsPoll);
}, 250);
setTimeout(() => clearInterval(walletsPoll), 15000);

function getBackpack() {
  registerWallets(); // lazy retry at click time
  if (eventWallet) return eventWallet;
  const wallets = walletsApi ? walletsApi.get() : [];
  return wallets.find((w) => w.name === "Backpack") || wallets[0] || null;
}

async function connect() {
  const wallet = getBackpack();
  diag(`connect click: eventWallet=${!!eventWallet} walletsApi=${!!walletsApi} navigatorWallets=${typeof window.navigator.wallets}`);
  if (!wallet) throw new Error("No Solana wallet found. Is Backpack installed and unlocked?");
  const result = await wallet.features["standard:connect"].connect();
  const account = result.accounts[0];
  diag(`connected account: chains=${JSON.stringify(account.chains || null)}`);
  if (account.chains && account.chains.length && !account.chains.includes(CHAIN)) {
    diag(`WARNING: wallet reports ${account.chains.join(",")}; proceeding anyway`);
  }
  connected = { wallet, account, payerPubkey: new web3.PublicKey(account.publicKey) };
  return account;
}

async function signAndSend(transaction) {
  const feature = connected.wallet.features["solana:signAndSendTransaction"];
  const txBytes = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const { signature } = await feature.signAndSendTransaction({
    account: connected.account,
    transaction: txBytes,
    chain: CHAIN,
    options: { preflightCommitment: "confirmed" },
  });
  await conn.confirmTransaction(signature, "confirmed");
  return signature;
}

// ---- Program instruction ---------------------------------------------------
function settleIx(orderIdBytes, amountLamports) {
  const [orderPda] = web3.PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("order"), MERCHANT.toBuffer(), orderIdBytes],
    PROGRAM_ID
  );
  const sighash = sha256(new TextEncoder().encode("global:settle_order")).slice(0, 8);
  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigUint64(0, BigInt(amountLamports), true);
  const data = u8concat([sighash, orderIdBytes, amount, RECIPIENT.toBuffer()]);
  return {
    orderPda,
    ix: new web3.TransactionInstruction({
      keys: [
        { pubkey: orderPda, isSigner: false, isWritable: true },
        { pubkey: MERCHANT, isSigner: false, isWritable: false },
        { pubkey: connected.payerPubkey, isSigner: true, isWritable: true },
        { pubkey: RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data,
    }),
  };
}

function buildTx(ix, feePayer) {
  const tx = new web3.Transaction().add(ix);
  tx.feePayer = feePayer;
  // recent blockhash is filled by the wallet at signing time
  return tx;
}

// ---- UI --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function orderIdBytes() {
  const raw = $("orderId").value;
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length === 0) throw new Error("Order id is required.");
  if (bytes.length > ORDER_ID_MAX_BYTES)
    throw new Error(`Order id is ${bytes.length} bytes; max ${ORDER_ID_MAX_BYTES}. Not sent.`);
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return padded;
}

function explorer(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function showResult(ok, title, detail, link) {
  const box = $("result");
  box.className = ok ? "result ok" : "result err";
  box.innerHTML = "";
  const t = document.createElement("div");
  t.className = "result-title";
  t.textContent = title;
  box.appendChild(t);
  if (detail) {
    const d = document.createElement("pre");
    d.textContent = detail;
    box.appendChild(d);
  }
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link;
    box.appendChild(a);
  }
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function parseError(e) {
  const msg = (e && (e.message || e.toString())) || "unknown error";
  // Surface the on-chain program error, not a generic toast.
  const m = msg.match(/OrderAlreadySettled/) ||
    msg.match(/custom program error: 0x[0-9a-fA-F]+/) ||
    msg.match(/already (in use|exists)/i);
  if (msg.includes("OrderAlreadySettled")) return "OrderAlreadySettled";
  if (m) return m[0];
  return msg.split("\n")[0];
}

async function refreshPda(orderId) {
  try {
    const [pda] = web3.PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("order"), MERCHANT.toBuffer(), orderId],
      PROGRAM_ID
    );
    const acct = await conn.getAccountInfo(pda);
    $("pdaStatus").textContent = acct
      ? `PDA exists: ${pda.toBase58()} (${acct.data.length} bytes)`
      : `PDA not created yet: ${pda.toBase58()}`;
  } catch (e) {
    $("pdaStatus").textContent = "";
  }
}

let pending = false;
function setBusy(b) {
  pending = b;
  $("submitBtn").disabled = b || !connected;
  $("doubleBtn").disabled = b || !connected;
}

async function doSubmit() {
  if (pending) return;
  let oid;
  try {
    oid = orderIdBytes();
  } catch (e) {
    showResult(false, "Page validation failed — nothing was sent.", e.message);
    return;
  }
  const amountLamports = Math.round(parseFloat($("amount").value || "0") * web3.LAMPORTS_PER_SOL);
  if (!(amountLamports > 0)) {
    showResult(false, "Page validation failed — nothing was sent.", "Amount must be positive.");
    return;
  }
  setBusy(true);
  $("result").className = "result";
  $("result").textContent = "Submitting one transaction…";
  try {
    const { ix } = settleIx(oid, amountLamports);
    const sig = await signAndSend(buildTx(ix, connected.payerPubkey));
    showResult(
      true,
      "Transfer landed. Order settled on chain.",
      `order id: ${$("orderId").value}\namount: ${amountLamports} lamports\nmerchant: ${MERCHANT.toBase58()}\nrecipient: ${RECIPIENT.toBase58()}\nmint: native SOL`,
      explorer(sig)
    );
  } catch (e) {
    showResult(false, "Transaction failed on chain.", parseError(e));
  } finally {
    setBusy(false);
    refreshPda(oid);
  }
}

async function doDoubleFire() {
  if (pending) return;
  let oid;
  try {
    oid = orderIdBytes();
  } catch (e) {
    showResult(false, "Page validation failed — nothing was sent.", e.message);
    return;
  }
  const amountLamports = Math.round(parseFloat($("amount").value || "0") * web3.LAMPORTS_PER_SOL);
  setBusy(true);
  $("result").className = "result";
  $("result").textContent = "Firing two submits together…";
  try {
    const { ix } = settleIx(oid, amountLamports);
    const results = await Promise.allSettled([
      signAndSend(buildTx(ix, connected.payerPubkey)),
      signAndSend(buildTx(ix, connected.payerPubkey)),
    ]);
    const landed = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    const lines = [];
    for (const r of landed) lines.push(`LANDED: ${explorer(r.value)}`);
    for (const r of failed) lines.push(`FAILED: ${parseError(r.reason)}`);
    showResult(
      landed.length === 1 && failed.length === 1,
      landed.length === 1
        ? "Two racing submits, one landed transfer."
        : "Unexpected outcome — inspect below.",
      lines.join("\n"),
      landed.length ? explorer(landed[0].value) : null
    );
  } catch (e) {
    showResult(false, "Double-fire failed.", parseError(e));
  } finally {
    setBusy(false);
    refreshPda(oid);
  }
}

$("connectBtn").addEventListener("click", async () => {
  try {
    const account = await connect();
    $("connectBtn").textContent = `Connected: ${account.address.slice(0, 6)}…${account.address.slice(-4)}`;
    $("submitBtn").disabled = false;
    $("doubleBtn").disabled = false;
    $("payer").textContent = `payer: ${account.address}`;
    $("payer").classList.add("mono");
  } catch (e) {
    showResult(false, "Connect failed.", e.message);
  }
});

$("submitBtn").addEventListener("click", doSubmit);
$("doubleBtn").addEventListener("click", doDoubleFire);
$("orderId").addEventListener("input", () => {
  try {
    const oid = orderIdBytes();
    $("orderIdHint").textContent = "";
    refreshPda(oid);
  } catch (e) {
    $("orderIdHint").textContent = e.message;
  }
});

$("merchant").textContent = MERCHANT.toBase58();
$("recipient").textContent = RECIPIENT.toBase58();
refreshPda(orderIdBytes());
