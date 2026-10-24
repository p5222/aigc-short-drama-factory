import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Amounts come from real downloaded bills. Platform credits are never converted to cash. */
export function reconcileBills(snapshot, bills) {
  if (!Array.isArray(snapshot.payments) || !Array.isArray(snapshot.providerRequests) ||
      !Array.isArray(bills.payments) || !Array.isArray(bills.providers)) throw new Error("Invalid normalized bill format");
  const issues = [], paymentMatches = [], supplierMatches = [];
  const unique = (rows, key, name) => {
    const map = new Map();
    for (const row of rows) {
      const id = key(row);
      if (!id || map.has(id)) throw new Error(`${name}: missing or duplicate identity`);
      map.set(id, row);
    }
    return map;
  };
  const money = row => {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0 || !/^[A-Z]{3}$/.test(row.currency ?? "")) throw new Error("Invalid bill amount/currency");
  };
  const paymentKey = row => typeof row.channel === "string" && row.channel && typeof row.tradeNo === "string" && row.tradeNo ? row.channel + ":" + row.tradeNo : null;
  const requestKey = row => typeof row.providerId === "string" && row.providerId && typeof row.requestId === "string" && row.requestId ? row.providerId + ":" + row.requestId : null;
  const localPayments = unique(snapshot.payments, paymentKey, "local payments");
  const billedPayments = unique(bills.payments, paymentKey, "payment bill");
  for (const [key, bill] of billedPayments) {
    money(bill);
    const local = localPayments.get(key);
    if (!local) { issues.push({ kind: "payment_without_local_record", key }); continue; }
    if (local.orderId !== bill.orderId || local.amountMinor !== bill.amountMinor || bill.currency !== "CNY" || bill.status !== "succeeded")
      issues.push({ kind: "payment_mismatch_or_refund_requires_review", key, orderId: local.orderId });
    else paymentMatches.push({ orderId: local.orderId, tradeNo: local.tradeNo, amountMinor: bill.amountMinor, currency: bill.currency });
  }
  for (const [key, local] of localPayments) if (!billedPayments.has(key))
    issues.push({ kind: "local_payment_missing_from_bill", key, orderId: local.orderId });

  const localRequests = unique(snapshot.providerRequests, requestKey, "provider requests");
  const billedRequests = unique(bills.providers, requestKey, "provider bill");
  const costByProviderCurrency = {};
  for (const [key, bill] of billedRequests) {
    money(bill);
    const local = localRequests.get(key);
    if (!local) { issues.push({ kind: "supplier_charge_without_task_receipt", key }); continue; }
    const group = `${bill.providerId}:${bill.currency}`;
    const next = (costByProviderCurrency[group] ?? 0) + bill.amountMinor;
    if (!Number.isSafeInteger(next)) throw new Error("Supplier bill total exceeds safe integer");
    costByProviderCurrency[group] = next;
    supplierMatches.push({ providerId: bill.providerId, requestId: bill.requestId, taskId: local.taskId,
      amountMinor: bill.amountMinor, currency: bill.currency, platformCredits: local.platformCredits });
  }
  for (const [key, local] of localRequests) if (!billedRequests.has(key))
    issues.push({ kind: "task_receipt_missing_from_supplier_bill", key, taskId: local.taskId });
  for (const item of snapshot.untraceableTasks ?? []) issues.push({ kind: "task_without_supplier_request_id", taskId: item.taskId });
  const hasEvidence = bills.payments.length + bills.providers.length > 0;
  return { status: !hasEvidence ? "insufficient_evidence" : issues.length ? "needs_review" : "matched",
    generatedAt: new Date().toISOString(), paymentMatches, supplierMatches, costByProviderCurrency, issues,
    scope: "Exact request/trade identifiers and original currency. No estimated costs, exchange rates or platform-credit conversion." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , snapshotPath, billPath, outputPath] = process.argv;
  if (!snapshotPath || !billPath || !outputPath) throw new Error("Usage: node reconcile-bills.mjs snapshot.json normalized-real-bills.json result.json");
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  const bills = JSON.parse(await fs.readFile(billPath, "utf8"));
  const report = reconcileBills(snapshot, bills);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, paymentMatches: report.paymentMatches.length,
    supplierMatches: report.supplierMatches.length, issues: report.issues.length }));
}
