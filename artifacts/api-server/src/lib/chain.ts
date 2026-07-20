import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blockchain } from "@workspace/chain-core";
import { createChainPersistenceHooks } from "./db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Local file is kept as a fast synchronous backup / fallback on first boot.
const dataFile = path.join(__dirname, "..", "..", "data", "chain.json");

export const chain = new Blockchain(dataFile, createChainPersistenceHooks());
