/** Real gateway callbacks need independent signature and amount verification.
 * A deployment flag must never enable simulated money on the production service. */
export function mockCheckoutEnabled(env: { NODE_ENV?: string; ENABLE_MOCK_PAYMENT?: string }) {
  return env.NODE_ENV !== "production" && env.ENABLE_MOCK_PAYMENT !== "false";
}
