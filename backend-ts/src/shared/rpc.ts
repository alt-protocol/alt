import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */

let _rpc: ReturnType<typeof createSolanaRpc> | null = null;
let _rpcSub: ReturnType<typeof createSolanaRpcSubscriptions> | null = null;
let _legacyConnection: any = null;

/** Shared lazy-initialized Solana RPC client (@solana/kit). */
export function getRpc() {
  if (!_rpc) _rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
  return _rpc;
}

/** Shared lazy-initialized Solana RPC subscriptions (WebSocket). */
export function getRpcSubscriptions() {
  if (!_rpcSub) {
    _rpcSub = createSolanaRpcSubscriptions(
      process.env.HELIUS_RPC_URL!.replace("https://", "wss://"),
    );
  }
  return _rpcSub;
}

/** Legacy @solana/web3.js Connection — required by protocol SDKs (Kamino, Drift, Jupiter). */
export async function getLegacyConnection(): Promise<any> {
  if (_legacyConnection) return _legacyConnection;
  const { Connection } = await import("@solana/web3.js");
  _legacyConnection = new Connection(process.env.HELIUS_RPC_URL!);
  return _legacyConnection;
}
