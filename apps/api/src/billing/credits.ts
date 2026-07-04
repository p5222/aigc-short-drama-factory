import type { CreditAccount, CreditTransaction, GenerationTask } from "@aifilm/shared";

export function canAfford(account: CreditAccount, credits: number) {
  return account.balance - account.frozenBalance >= credits;
}

export function freezeCredits(account: CreditAccount, task: GenerationTask, transactions: CreditTransaction[]) {
  if (!canAfford(account, task.estimatedCredits)) {
    throw new Error("积分余额不足");
  }

  account.frozenBalance += task.estimatedCredits;
  transactions.unshift({
    id: `tx_${Date.now()}`,
    type: "freeze",
    amount: -task.estimatedCredits,
    balanceAfter: account.balance,
    description: `${task.title} 冻结积分`,
    taskId: task.id,
    projectId: task.projectId,
    createdAt: new Date().toISOString()
  });
}

export function settleCredits(account: CreditAccount, task: GenerationTask, transactions: CreditTransaction[]) {
  const finalCredits = task.finalCredits ?? task.estimatedCredits;
  account.frozenBalance = Math.max(0, account.frozenBalance - task.estimatedCredits);
  account.balance -= finalCredits;
  account.totalConsume += finalCredits;
  transactions.unshift({
    id: `tx_${Date.now()}`,
    type: "consume",
    amount: -finalCredits,
    balanceAfter: account.balance,
    description: `${task.title} 正式扣费`,
    taskId: task.id,
    projectId: task.projectId,
    createdAt: new Date().toISOString()
  });
}

