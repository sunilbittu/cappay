use anchor_lang::prelude::*;

declare_id!("ETH1s4zbujtUuhM8WBoAErd8DpbYb4ea8e3wV9huV7fe");

/// CapPay: idempotent agent payment guard.
///
/// The idempotency key is (merchant, order_id). The order account is a PDA
/// seeded by ["order", merchant, order_id] and is created in the same
/// transaction as the transfer. A second instruction with the same key fails
/// with OrderAlreadySettled; the first bound values (payer, recipient,
/// amount, mint) stay bound.
#[program]
pub mod cappay {
    use super::*;

    pub fn settle_order(
        ctx: Context<SettleOrder>,
        order_id: [u8; 32],
        amount: u64,
        recipient: Pubkey,
    ) -> Result<()> {
        let order = &mut ctx.accounts.order;

        // The PDA already exists => this key settled before. Reject even if
        // payer, amount, or recipient differ; first values stay bound.
        if order.settled {
            return err!(ErrorCode::OrderAlreadySettled);
        }

        order.merchant = ctx.accounts.merchant.key();
        order.payer = ctx.accounts.payer.key();
        order.recipient = recipient;
        order.amount = amount;
        order.mint = Pubkey::default(); // native SOL
        order.settled = true;

        // Transfer native SOL in the same transaction as account creation.
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &recipient,
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
            ],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct SettleOrder<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", merchant.key().as_ref(), order_id.as_ref()],
        bump,
    )]
    pub order: Account<'info, Order>,
    /// CHECK: the merchant pubkey is a fixed constant checked into the README.
    pub merchant: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the recipient is a plain wallet receiving lamports via the
    /// system program; no data is read from it.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub merchant: Pubkey,
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    pub settled: bool,
}

#[error_code]
pub enum ErrorCode {
    #[msg("OrderAlreadySettled: this merchant and order id already settled on chain")]
    OrderAlreadySettled,
}
