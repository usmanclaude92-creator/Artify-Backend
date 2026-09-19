/**
 * Password hashing. Fixes Phase 0 finding S5/R5: unsalted SHA-256
 * (`crypto.createHash('sha256')`) is never used for password storage in
 * this codebase. bcryptjs is used instead of native `bcrypt` to keep the
 * Phase 1 build dependency-free of a native-addon toolchain across every
 * deployment target (Railway/Vercel/local) — cost factor 12 keeps the
 * per-hash time in the same practical range as native bcrypt at this cost.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainTextPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, hash);
}
