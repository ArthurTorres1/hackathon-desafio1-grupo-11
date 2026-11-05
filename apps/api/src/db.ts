import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
dotenv.config({ path: resolve(workspaceRoot, '.env'), quiet: true });
const globalForPrisma = globalThis as unknown as { foresttracePrisma?: PrismaClient };
export const prisma = globalForPrisma.foresttracePrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.foresttracePrisma = prisma;
