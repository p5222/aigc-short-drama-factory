import assert from "node:assert/strict";
import test from "node:test";
import { QQ_EMAIL_PATTERN, registrationMailConfig } from "./emailVerification.js";

test("registration policy accepts QQ numeric and alias mailboxes, and rejects lookalike domains", () => {
  for (const email of ["12345678@qq.com", "my.alias@qq.com", "HELLO@qq.com"]) assert.ok(QQ_EMAIL_PATTERN.test(email));
  for (const email of ["test@example.com", "test@qq.com.evil.test", "test@foxmail.com", "test+tag@qq.com", " test@qq.com", "a\n@qq.com"]) assert.equal(QQ_EMAIL_PATTERN.test(email), false);
});

test("SMTP configuration fails closed without credentials and defaults to QQ TLS", () => {
  assert.equal(registrationMailConfig({}), null);
  assert.equal(registrationMailConfig({ REGISTRATION_SMTP_USER: "test@qq.com" }), null);
  const config = registrationMailConfig({ REGISTRATION_SMTP_USER: "sender@qq.com", REGISTRATION_SMTP_PASSWORD: "isolated-test-only" });
  assert.equal(config?.host, "smtp.qq.com");
  assert.equal(config?.port, 465);
  assert.equal(config?.secure, true);
  assert.equal(registrationMailConfig({ REGISTRATION_SMTP_USER: "sender@qq.com", REGISTRATION_SMTP_PASSWORD: "test", REGISTRATION_SMTP_PORT: "NaN" }), null);
});
