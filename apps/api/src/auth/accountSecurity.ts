import crypto from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { EmailVerificationError, EmailVerificationService, QQ_EMAIL_PATTERN } from "./emailVerification.js";
import { hashPassword, verifyPassword } from "./password.js";

const recoveryFailure = () => new EmailVerificationError(400, "无法完成找回，请确认已验证的 QQ 邮箱与验证码，或联系平台管理员。");
// A monotonic version prevents old codes reviving after disable/re-enable or email A→B→A.
export function accountSecurityBinding(user: User) {
  return crypto.createHash("sha256").update(JSON.stringify([
    user.id, user.email, user.passwordHash, user.authVersion, user.role, user.status, user.emailVerifiedAt?.toISOString()
  ])).digest("hex");
}

export class AccountSecurityService {
  constructor(private db: PrismaClient, private bindingMail: EmailVerificationService, private recoveryMail: EmailVerificationService) {}

  private async current(userId: string, password: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "active") throw new EmailVerificationError(401, "登录已过期，请重新登录。");
    if (!await verifyPassword(password, user.passwordHash)) throw new EmailVerificationError(400, "当前密码不正确。");
    return user;
  }

  private async eligible(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    return user?.status === "active" && user.role === "creator" && user.emailVerifiedAt
      && user.passwordHash && QQ_EMAIL_PATTERN.test(email) ? user : null;
  }

  async sendBinding(userId: string, email: string, password: string, ip: string) {
    const user = await this.current(userId, password);
    return this.bindingMail.send(email, ip, accountSecurityBinding(user));
  }

  async verifyBinding(userId: string, email: string, password: string, code: string) {
    const user = await this.current(userId, password);
    return this.bindingMail.verify(email, code, accountSecurityBinding(user));
  }

  async sendRecovery(email: string, ip: string) {
    const user = await this.eligible(email);
    // Same delivery, cooldown and response for absent, unverified, disabled and privileged
    // accounts. The unusable random binding can never issue a recovery grant.
    return this.recoveryMail.send(email, ip, user ? accountSecurityBinding(user) : crypto.randomBytes(32).toString("hex"));
  }

  async verifyRecovery(email: string, code: string) {
    const user = await this.eligible(email);
    try {
      const result = await this.recoveryMail.verify(email, code, user ? accountSecurityBinding(user) : "ineligible");
      if (!user) throw recoveryFailure();
      return result;
    } catch (error) {
      if (error instanceof EmailVerificationError && error.status === 400) throw recoveryFailure();
      throw error;
    }
  }

  // Password work happens before acquiring the row lock. The locked comparison then
  // serializes with login, administrator mutations and every other security change.
  private async mutate(expected: User, data: { email?: string; emailVerifiedAt?: Date; passwordHash?: string }) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${expected.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: expected.id } });
      if (!current || current.status !== "active" || accountSecurityBinding(current) !== accountSecurityBinding(expected)) {
        throw new EmailVerificationError(409, "账户安全设置已变化，请重新登录并验证。");
      }
      const user = await tx.user.update({ where: { id: expected.id }, data: { ...data, authVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: expected.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return user;
    });
  }

  private async withGrant<T>(service: EmailVerificationService, user: User, email: string, token: string, action: () => Promise<T>) {
    const binding = accountSecurityBinding(user);
    const expiresAt = Date.now() + (await service.consume(email, token, binding)) * 1000;
    try { return await action(); }
    catch (error) {
      // Restoration retains the original expiry and old binding. A committed mutation
      // changes authVersion, so even an ambiguous DB error cannot revive a spent grant.
      await service.restore(email, token, expiresAt, binding);
      if (error instanceof EmailVerificationError) throw error;
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        throw new EmailVerificationError(409, "该邮箱已绑定其他账号。");
      }
      // Do not expose/log Prisma's input arguments, password hashes or grants.
      throw new EmailVerificationError(503, "账户更新未确认，请尝试登录核对；如未更新，请重试。");
    }
  }

  async bindEmail(userId: string, email: string, password: string, token: string) {
    if (!QQ_EMAIL_PATTERN.test(email)) throw new EmailVerificationError(400, "请使用 qq.com 邮箱。");
    const user = await this.current(userId, password);
    return this.withGrant(this.bindingMail, user, email, token, () => this.mutate(user, { email, emailVerifiedAt: new Date() }));
  }

  async resetPassword(email: string, token: string, newPassword: string) {
    const user = await this.eligible(email);
    if (!user) throw recoveryFailure();
    const passwordHash = await hashPassword(newPassword);
    try { await this.withGrant(this.recoveryMail, user, email, token, () => this.mutate(user, { passwordHash })); }
    catch (error) {
      if (error instanceof EmailVerificationError && error.status === 400) throw recoveryFailure();
      throw error;
    }
    return { ok: true as const, requiresLogin: true as const };
  }

  async changePassword(userId: string, password: string, newPassword: string) {
    const user = await this.current(userId, password);
    const passwordHash = await hashPassword(newPassword);
    try { await this.mutate(user, { passwordHash }); }
    catch (error) {
      if (error instanceof EmailVerificationError) throw error;
      throw new EmailVerificationError(503, "密码更新未确认，请尝试登录核对。");
    }
    return { ok: true as const, requiresLogin: true as const };
  }
}
