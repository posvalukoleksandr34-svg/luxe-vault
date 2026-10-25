/**
 * The most of one item (one product, size and colour) a single order can
 * hold. The cart, its saved copy and the server all apply the same number,
 * so what the customer sees in the basket is what they are charged for:
 * the server clamps any line above it (lib/server/order-drafts.ts), and the
 * cart refuses to go past it with a message instead of letting it be cut
 * silently at checkout.
 */
export const MAX_LINE_QTY = 20
