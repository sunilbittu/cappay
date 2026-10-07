// CapPay devnet end-to-end check (C3, C4, C5).
// 1. settle order NL-10482 -> lands, one transfer, PDA created
// 2. retry same order id -> must fail with OrderAlreadySettled
// 3. second wallet, same order id -> must fail with OrderAlreadySettled
const web3 = require("@solana/web3.js");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROGRAM_ID = new web3.PublicKey("ETH1s4zbujtUuhM8WBoAErd8DpbYb4ea8e3wV9huV7fe");
// Merchant = the README/deployer pubkey.
const MERCHANT = new web3.PublicKey("FCUUc1Mov2WijVEuAcyZajrTZLg3vhviCsfiD72NmRRu");
const RECIPIENT = new web3.PublicKey("6W6q2VUcr1bbrKRoEh1a7E66bw8jbxDw9DpCruLHA5Aq");
const AMOUNT = 10_000_000; // 0.01 SOL
const ORDER_ID_STR = "NL-10482";

const orderId = Buffer.alloc(32);
orderId.write(ORDER_ID_STR, 0, "utf8");

function keypair(p) {
  return web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}
const payer = keypair(path.join(os.homedir(), ".config/solana/id.json"));
const wallet2 = keypair(process.argv[2]); // path to second wallet keypair

const conn = new web3.Connection("https://api.devnet.solana.com", "confirmed");

function settleIx(payerPub, amount, recipient) {
  const [orderPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("order"), MERCHANT.toBuffer(), orderId],
    PROGRAM_ID
  );
  // Anchor: sighash("global:settle_order") + order_id[32] + amount u64 LE + recipient[32]
  const sighash = crypto
    .createHash("sha256")
    .update("global:settle_order")
    .digest()
    .subarray(0, 8);
  const data = Buffer.concat([
    sighash,
    orderId,
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(amount)); return b; })(),
    recipient.toBuffer(),
  ]);
  return new web3.TransactionInstruction({
    keys: [
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: MERCHANT, isSigner: false, isWritable: false },
      { pubkey: payerPub, isSigner: true, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

async function send(label, signer, ix) {
  const tx = new web3.Transaction().add(ix);
  try {
    const sig = await web3.sendAndConfirmTransaction(conn, tx, [signer]);
    console.log(`${label}: LANDED  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return sig;
  } catch (e) {
    const msg = e.message || String(e);
    const hit = msg.includes("OrderAlreadySettled") ? "OrderAlreadySettled" : msg.split("\n")[0];
    console.log(`${label}: FAILED  ${hit}`);
    return null;
  }
}

(async () => {
  console.log(`order id: ${ORDER_ID_STR} (padded to 32 bytes)`);
  console.log(`amount:   ${AMOUNT} lamports to ${RECIPIENT.toBase58()}\n`);
  await send("1. first settle (payer)        ", payer, settleIx(payer.publicKey, AMOUNT, RECIPIENT));
  await send("2. retry same order id         ", payer, settleIx(payer.publicKey, AMOUNT, RECIPIENT));
  await send("3. second wallet, same order id", wallet2, settleIx(wallet2.publicKey, AMOUNT, RECIPIENT));

  const [orderPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("order"), MERCHANT.toBuffer(), orderId],
    PROGRAM_ID
  );
  const acct = await conn.getAccountInfo(orderPda);
  console.log(`\nPDA ${orderPda.toBase58()}: ${acct ? "exists (" + acct.data.length + " bytes)" : "MISSING"}`);
  const bal = await conn.getBalance(RECIPIENT);
  console.log(`recipient balance: ${bal} lamports (expect ${AMOUNT} exactly)`);
})();
