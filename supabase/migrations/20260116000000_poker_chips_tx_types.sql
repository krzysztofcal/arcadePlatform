alter type public.chips_tx_type add value if not exists 'TABLE_BUY_IN';

alter type public.chips_tx_type add value if not exists 'TABLE_CASH_OUT';

alter type public.chips_tx_type add value if not exists 'HAND_SETTLEMENT';
