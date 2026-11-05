import type { Prisma } from '../../generated/prisma/client.js';

/** Bir transaction içindeki Prisma istemcisi. Olay ve denetim kaydı iş verisiyle aynı transaction'a yazılır. */
export type Tx = Prisma.TransactionClient;
