import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

export async function hashPassword(password: string) {
  if (typeof password !== "string" || password.length < 8 || password.length > 1024) throw new Error("密码长度必须为 8 到 1024 个字符");
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash?: string | null) {
  if (typeof password !== "string" || password.length > 1024 || !passwordHash) return false;
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash)) return false;
  const [method, salt, storedKey] = passwordHash.split("$");
  if (method !== "scrypt" || !salt || !storedKey) return false;
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(storedKey, "hex");
  return storedBuffer.length === derivedKey.length && crypto.timingSafeEqual(storedBuffer, derivedKey);
}
