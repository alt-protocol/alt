import { createSolanaRpcFromTransport } from "@solana/kit";
import type { SolanaRpcApi, Rpc } from "@solana/kit";
import { createHttpTransportForSolanaRpc } from "@solana/rpc-transport-http";
import { HELIUS_RPC_URL } from "./constants";

let _rpc: Rpc<SolanaRpcApi> | null = null;

/**
 * Shared lazy-initialized Solana RPC client.
 *
 * Uses a custom transport that omits the `solana-client` header —
 * the RPC proxy doesn't include it in Access-Control-Allow-Headers,
 * so the browser's CORS preflight rejects all RPC calls.
 */
export function getRpc(): Rpc<SolanaRpcApi> {
  if (!_rpc) {
    const transport = createHttpTransportForSolanaRpc({ url: HELIUS_RPC_URL });
    _rpc = createSolanaRpcFromTransport(transport) as Rpc<SolanaRpcApi>;
  }
  return _rpc;
}
