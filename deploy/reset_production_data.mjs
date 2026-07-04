import crypto from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const scryptAsync = promisify(crypto.scrypt);
const prisma = new PrismaClient();

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const phone = requiredEnv("PRODUCT_ADMIN_PHONE").trim();
const password = requiredEnv("PRODUCT_ADMIN_PASSWORD");
const name = process.env.PRODUCT_ADMIN_NAME?.trim() || `用户${phone.slice(-4)}`;
const initialCredits = Number(process.env.PRODUCT_ADMIN_INITIAL_CREDITS ?? 100000);
const userId = process.env.PRODUCT_ADMIN_USER_ID || `user_${phone}`;

if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error("PRODUCT_ADMIN_PHONE must be a mainland China mobile number.");
if (password.length < 6) throw new Error("PRODUCT_ADMIN_PASSWORD must be at least 6 chars.");

const preservedUsers = new Set([userId]);

await prisma.$transaction(async (tx) => {
  await tx.authSession.deleteMany({});
  await tx.analyticsEvent.deleteMany({});
  await tx.userFeedback.deleteMany({});
  await tx.qualityReport.deleteMany({});
  await tx.evaluationRun.deleteMany({});
  await tx.evaluationDataset.deleteMany({});
  await tx.experimentRun.deleteMany({});
  await tx.promptVersion.deleteMany({});
  await tx.exportJob.deleteMany({});
  await tx.invoice.deleteMany({});
  await tx.paymentRecord.deleteMany({});
  await tx.rechargeOrder.deleteMany({});
  await tx.redeemRedemption.deleteMany({});
  await tx.creditTransaction.deleteMany({});
  await tx.generationTask.deleteMany({});
  await tx.storyboard.deleteMany({});
  await tx.asset.deleteMany({});
  await tx.character.deleteMany({});
  await tx.scriptDraft.deleteMany({});
  await tx.project.deleteMany({});
  await tx.creditAccount.deleteMany({});
  await tx.user.deleteMany({ where: { id: { notIn: [...preservedUsers] } } });

  const passwordHash = await hashPassword(password);
  const user = await tx.user.upsert({
    where: { id: userId },
    update: {
      name,
      phone,
      email: null,
      passwordHash,
      role: "admin",
      status: "active",
      lastLoginAt: null
    },
    create: {
      id: userId,
      name,
      phone,
      email: null,
      passwordHash,
      role: "admin",
      status: "active"
    }
  });

  await tx.creditAccount.upsert({
    where: { userId: user.id },
    update: {
      balance: initialCredits,
      frozenBalance: 0,
      totalRecharge: initialCredits,
      totalConsume: 0
    },
    create: {
      id: `credit_${user.id}`,
      userId: user.id,
      balance: initialCredits,
      frozenBalance: 0,
      totalRecharge: initialCredits,
      totalConsume: 0
    }
  });
});

const counts = {
  users: await prisma.user.count(),
  projects: await prisma.project.count(),
  tasks: await prisma.generationTask.count(),
  assets: await prisma.asset.count(),
  storyboards: await prisma.storyboard.count(),
  providers: await prisma.modelProvider.count(),
  templates: await prisma.promptTemplate.count()
};

console.log(JSON.stringify({ ok: true, userId, phone, role: "admin", counts }, null, 2));
await prisma.$disconnect();
