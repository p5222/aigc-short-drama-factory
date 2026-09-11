import type { Prisma } from "@prisma/client";

/** Acquire after the operation's own row / advisory lock, and read the balance
 * again under that lock so adjustments cannot spend another task's reservation. */
export async function lockCreditAccount(tx: Prisma.TransactionClient, userId: string) {
  await tx.creditAccount.upsert({ where: { userId }, update: {}, create: {
    id: `credit_${userId}`, userId, balance: 0, frozenBalance: 0, totalRecharge: 0, totalConsume: 0
  } });
  await tx.$queryRaw`SELECT "id" FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`;
  return tx.creditAccount.findUniqueOrThrow({ where: { userId } });
}
