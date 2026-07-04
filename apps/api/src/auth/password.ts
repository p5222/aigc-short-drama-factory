import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash?: string | null) {
  if (!passwordHash) return false;
  const [method, salt, storedKey] = passwordHash.split("$");
  if (method !== "scrypt" || !salt || !storedKey) return false;
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(storedKey, "hex");
  return storedBuffer.length === derivedKey.length && crypto.timingSafeEqual(storedBuffer, derivedKey);
}
