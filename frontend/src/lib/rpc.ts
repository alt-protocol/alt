import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { HELIUS_RPC_URL } from "./constants";

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;
let _rpcSub: ReturnType<typeof createSolanaRpcSubscriptions> | null = null;

/** Shared lazy-initialized Solana RPC client. */
export function getRpc() {
  if (!_rpc) _rpc = createSolanaRpc(HELIUS_RPC_URL);
  return _rpc;
}

/** Shared lazy-initialized Solana RPC subscriptions (WebSocket). */
export function getRpcSubscriptions() {
  if (!_rpcSub) _rpcSub = createSolanaRpcSubscriptions(HELIUS_RPC_URL.replace("https://", "wss://"));
  return _rpcSub;
}
