import { createSolanaRpc } from "@solana/kit";
import { HELIUS_RPC_URL } from "./constants";

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;

/** Shared lazy-initialized Solana RPC client. */
export function getRpc() {
  if (!_rpc) _rpc = createSolanaRpc(HELIUS_RPC_URL);
  return _rpc;
}
