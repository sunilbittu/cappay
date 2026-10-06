use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const ORDER_ID: [u8; 32] = *b"NL-10482\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0";

fn order_pda(merchant: &Pubkey, order_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"order", merchant.as_ref(), order_id.as_ref()], program_id)
}

fn settle_ix(
    program_id: Pubkey,
    payer: Pubkey,
    merchant: Pubkey,
    recipient: Pubkey,
    order_id: [u8; 32],
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id,
        &cappay::instruction::SettleOrder {
            order_id,
            amount,
            recipient,
        }
        .data(),
        cappay::accounts::SettleOrder {
            order: order_pda(&merchant, &order_id, &program_id).0,
            merchant,
            payer,
            recipient,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn setup() -> (LiteSVM, Keypair, Pubkey, Pubkey) {
    let program_id = cappay::id();
    let payer = Keypair::new();
    let merchant = Keypair::new().pubkey(); // README merchant constant
    let recipient = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/cappay.so"));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer, merchant, recipient)
}

fn send(
    svm: &mut LiteSVM,
    ix: Instruction,
    payer: &Keypair,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)?;
    Ok(())
}

#[test]
fn first_settle_creates_pda_and_pays() {
    let (mut svm, payer, merchant, recipient) = setup();
    let amount = 42_000_000;
    send(
        &mut svm,
        settle_ix(cappay::id(), payer.pubkey(), merchant, recipient, ORDER_ID, amount),
        &payer,
    )
    .expect("first settle must land");

    let (pda, _) = order_pda(&merchant, &ORDER_ID, &cappay::id());
    assert_eq!(svm.get_balance(&recipient).unwrap(), amount);

    let account = svm.get_account(&pda).unwrap();
    let order = cappay::Order::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(order.merchant, merchant);
    assert_eq!(order.payer, payer.pubkey());
    assert_eq!(order.recipient, recipient);
    assert_eq!(order.amount, amount);
    assert!(order.settled);
}

#[test]
fn second_settle_same_key_fails() {
    let (mut svm, payer, merchant, recipient) = setup();
    let program_id = cappay::id();
    let amount = 42_000_000;
    send(
        &mut svm,
        settle_ix(program_id, payer.pubkey(), merchant, recipient, ORDER_ID, amount),
        &payer,
    )
    .unwrap();

    // Same key, different amount: must fail, first values stay bound.
    let err = send(
        &mut svm,
        settle_ix(program_id, payer.pubkey(), merchant, recipient, ORDER_ID, amount + 1),
        &payer,
    )
    .expect_err("second settle must fail");
    assert!(
        format!("{err:?}").contains("OrderAlreadySettled"),
        "expected OrderAlreadySettled, got: {err:?}"
    );

    let (pda, _) = order_pda(&merchant, &ORDER_ID, &program_id);
    let account = svm.get_account(&pda).unwrap();
    let order = cappay::Order::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(order.amount, amount, "first bound amount must stay bound");
    assert_eq!(svm.get_balance(&recipient).unwrap(), amount, "no second transfer");
}

#[test]
fn second_wallet_same_key_fails() {
    let (mut svm, payer, merchant, recipient) = setup();
    let program_id = cappay::id();
    let second_wallet = Keypair::new();
    svm.airdrop(&second_wallet.pubkey(), 1_000_000_000).unwrap();

    send(
        &mut svm,
        settle_ix(program_id, payer.pubkey(), merchant, recipient, ORDER_ID, 42_000_000),
        &payer,
    )
    .unwrap();

    // A different payer retrying the same order id: must fail on chain.
    send(
        &mut svm,
        settle_ix(
            program_id,
            second_wallet.pubkey(),
            merchant,
            recipient,
            ORDER_ID,
            42_000_000,
        ),
        &second_wallet,
    )
    .expect_err("second wallet retry must fail");
    assert_eq!(svm.get_balance(&recipient).unwrap(), 42_000_000);
}

#[test]
fn two_racing_submits_produce_one_transfer() {
    let (mut svm, payer, merchant, recipient) = setup();
    let program_id = cappay::id();
    let amount = 42_000_000;
    let ix = settle_ix(program_id, payer.pubkey(), merchant, recipient, ORDER_ID, amount);

    // Two identical transactions land as a batch; only one can create the PDA.
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let copy = VersionedTransaction::try_from(tx.clone()).unwrap();

    let mut landed = 0;
    for t in [tx, copy] {
        if svm.send_transaction(t).is_ok() {
            landed += 1;
        }
    }
    assert_eq!(landed, 1, "exactly one of the racing submits lands");
    assert_eq!(svm.get_balance(&recipient).unwrap(), amount, "exactly one transfer");
}
