/**
 * E2E test: Kamino Multiply Open with KSwap routing (matches Kamino docs)
 *
 * node scripts/test-multiply.mjs
 */

import {
  createSolanaRpc, createSolanaRpcSubscriptions,
  address, none, createKeyPairSignerFromBytes,
  pipe, createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  fetchAddressesForLookupTables,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
} from "@solana/kit";
import { fetchAllAddressLookupTable } from "@solana-program/address-lookup-table";
import Decimal from "decimal.js";
import BN from "bn.js";
import bs58 from "bs58";

const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=ef75b74d-f6b7-4d82-ad83-5536651c8003";
const WS_URL = RPC_URL.replace("https://", "wss://");
const KSWAP_API = "https://api.kamino.finance/kswap";
const CDN = "https://cdn.kamino.finance";

const MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const COLL_MINT = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"; // USDG
const DEBT_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";   // USD1
const MAIN_MARKET_LUT = "GprZNyWk67655JhX6Rq9KoebQ6WkQYRhATWzkx2P2LNc";

const DEPOSIT = "0.1";
const LEVERAGE = 2.0;
const SLIPPAGE_BPS = 500; // 5%
const PK = "2tnkoPS8FVKGxUNMVL5bAzYB3hppxyU1f8NxVdaBiHU7aUCc2WaKtL5DM1LxMybFWBFSDBURpJmphpiKtuvFPCuc";

const ALLOWED_ROUTERS = ["metis", "titan", "dflow", "openOcean", "jupiterLite"];

async function main() {
  console.log("=== Kamino Multiply E2E (KSwap routing) ===\n");

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSub = createSolanaRpcSubscriptions(WS_URL);
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(bs58.decode(PK)));
  console.log("Wallet:", signer.address);

  const sdk = await import("@kamino-finance/klend-sdk");
  const { KswapSdk, RouterContext } = await import("@kamino-finance/kswap-sdk");

  // 1. Load market
  console.log("\n--- 1. Market ---");
  const market = await sdk.KaminoMarket.load(rpc, address(MARKET), sdk.DEFAULT_RECENT_SLOT_DURATION_MS);
  if (!market) throw new Error("Market load failed");
  const collReserve = market.getReserveByMint(address(COLL_MINT));
  const debtReserve = market.getReserveByMint(address(DEBT_MINT));
  if (!collReserve || !debtReserve) throw new Error("Reserves not found");
  console.log("✓");

  // 2. KSwap SDK
  console.log("\n--- 2. KSwap ---");
  const kswapSdk = new KswapSdk(KSWAP_API, rpc, rpcSub);
  console.log("✓");

  // 3. User LUT + setup
  console.log("\n--- 3. User LUT ---");
  const multiplyMints = [{ coll: address(COLL_MINT), debt: address(DEBT_MINT) }];
  const [userLut, setupTxsIxs] = await sdk.getUserLutAddressAndSetupIxs(
    market, signer, none(), true, multiplyMints, [],
  );
  const nonEmpty = setupTxsIxs.filter(ixs => ixs.length > 0);
  console.log(`User LUT: ${userLut}, setup: ${nonEmpty.length}`);

  if (nonEmpty.length > 0) {
    for (let i = 0; i < nonEmpty.length; i++) {
      const { value: bh } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
      const msg = pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayerSigner(signer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
        m => appendTransactionMessageInstructions(nonEmpty[i], m),
      );
      const signed = await signTransactionMessageWithSigners(msg);
      await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub })(signed, { commitment: "confirmed", skipPreflight: true });
      console.log(`  ✓ Setup ${i+1} confirmed`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 4. Obligation
  console.log("\n--- 4. Obligation ---");
  const oblAddr = await new sdk.MultiplyObligation(address(COLL_MINT), address(DEBT_MINT), sdk.PROGRAM_ID)
    .toPda(market.getAddress(), signer.address);
  let obligation = null;
  try { obligation = await market.getObligationByAddress(oblAddr); console.log("✓ existing"); }
  catch { console.log("✓ new"); }

  // 5. Scope
  console.log("\n--- 5. Scope ---");
  const { Scope } = await import("@kamino-finance/scope-sdk");
  const scope = new Scope("mainnet-beta", rpc);
  const scopeConfig = { scope, scopeConfigurations: await scope.getAllConfigurations() };
  const scopeRefreshIx = obligation
    ? await sdk.getScopeRefreshIxForObligationAndReserves(market, collReserve, debtReserve, obligation, scopeConfig)
    : [];
  console.log(`✓ ${scopeRefreshIx.length} ixs`);

  // 6. Price
  console.log("\n--- 6. Price ---");
  const priceRes = await fetch(`https://lite-api.jup.ag/price/v3?ids=${DEBT_MINT},${COLL_MINT}`);
  const priceData = await priceRes.json();
  const debtP = Number(priceData?.[DEBT_MINT]?.usdPrice || 0);
  const collP = Number(priceData?.[COLL_MINT]?.usdPrice || 0);
  if (!debtP || !collP) throw new Error(`Price missing: debt=$${debtP} coll=$${collP}`);
  const priceDebtToColl = new Decimal(debtP / collP);
  console.log(`✓ ratio=${priceDebtToColl}`);

  // 7. KSwap quoter/swapper (following Kamino docs exactly)
  console.log("\n--- 7. Build routes (KSwap) ---");
  const computeIxs = sdk.getComputeBudgetAndPriorityFeeIxs(1_400_000, new Decimal(500000));
  const currentSlot = await rpc.getSlot().send();

  function getKswapQuoter() {
    return async (inputs) => {
      const inMintInfo = { tokenProgramId: debtReserve.getLiquidityTokenProgram(), decimals: debtReserve.stats.decimals };
      const outMintInfo = { tokenProgramId: collReserve.getLiquidityTokenProgram(), decimals: collReserve.stats.decimals };
      const routerContext = new RouterContext(inMintInfo, outMintInfo);

      const routeParams = {
        executor: signer.address,
        tokenIn: inputs.inputMint,
        tokenOut: inputs.outputMint,
        amount: new BN(inputs.inputAmountLamports.toDP(0).toString()),
        maxSlippageBps: SLIPPAGE_BPS,
        wrapAndUnwrapSol: false,
        swapType: "exactIn",
        routerTypes: ALLOWED_ROUTERS,
        includeRfq: false,
        includeLimoLogs: false,
        withSimulation: true,
        filterFailedSimulations: false,
        timeoutMs: 30000,
        atLeastOneNoMoreThanTimeoutMS: 15000,
        preferredMaxAccounts: 10,
      };

      console.log(`  [quoter] ${String(inputs.inputMint).slice(0,6)}→${String(inputs.outputMint).slice(0,6)} amt=${routeParams.amount.toString()}`);
      const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
      if (routeOutputs.routes.length === 0) throw new Error("No routes found");

      const best = routeOutputs.routes.reduce((b, c) => {
        const bPrice = new Decimal(b.amountsExactIn.amountOutGuaranteed.toString()).div(new Decimal(b.amountsExactIn.amountIn.toString()));
        const cPrice = new Decimal(c.amountsExactIn.amountOutGuaranteed.toString()).div(new Decimal(c.amountsExactIn.amountIn.toString()));
        return bPrice.greaterThan(cPrice) ? b : c;
      });

      const inAmt = new Decimal(best.amountsExactIn.amountIn.toString()).div(debtReserve.getMintFactor());
      const outAmt = new Decimal(best.amountsExactIn.amountOutGuaranteed.toString()).div(collReserve.getMintFactor());
      console.log(`  [quoter] ✓ price=${outAmt.div(inAmt)}`);
      return { priceAInB: outAmt.div(inAmt), quoteResponse: best };
    };
  }

  function getKswapSwapper() {
    return async (inputs) => {
      const inMintInfo = { tokenProgramId: debtReserve.getLiquidityTokenProgram(), decimals: debtReserve.stats.decimals };
      const outMintInfo = { tokenProgramId: collReserve.getLiquidityTokenProgram(), decimals: collReserve.stats.decimals };
      const routerContext = new RouterContext(inMintInfo, outMintInfo);

      const routeParams = {
        executor: signer.address,
        tokenIn: inputs.inputMint,
        tokenOut: inputs.outputMint,
        amount: new BN(inputs.inputAmountLamports.toDP(0).toString()),
        maxSlippageBps: SLIPPAGE_BPS,
        wrapAndUnwrapSol: false,
        swapType: "exactIn",
        routerTypes: ALLOWED_ROUTERS,
        includeRfq: false,
        includeLimoLogs: false,
        withSimulation: true,
        filterFailedSimulations: false,
        timeoutMs: 30000,
        atLeastOneNoMoreThanTimeoutMS: 15000,
        preferredMaxAccounts: 10,
      };

      console.log(`  [swapper] ${String(inputs.inputMint).slice(0,6)}→${String(inputs.outputMint).slice(0,6)}`);
      const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
      if (routeOutputs.routes.length === 0) throw new Error("No swap routes");

      return routeOutputs.routes.map(route => {
        const inAmt = new Decimal(route.amountsExactIn.amountIn.toString()).div(debtReserve.getMintFactor());
        const outAmt = new Decimal(route.amountsExactIn.amountOutGuaranteed.toString()).div(collReserve.getMintFactor());
        return {
          preActionIxs: [],
          swapIxs: route.instructions?.swapIxs || [],
          lookupTables: route.lookupTableAccounts || [],
          quote: { priceAInB: outAmt.div(inAmt), quoteResponse: route, routerType: route.routerType },
        };
      });
    };
  }

  const routes = await sdk.getDepositWithLeverageIxs({
    owner: signer,
    kaminoMarket: market,
    debtTokenMint: address(DEBT_MINT),
    collTokenMint: address(COLL_MINT),
    depositAmount: new Decimal(DEPOSIT),
    priceDebtToColl,
    slippagePct: new Decimal(SLIPPAGE_BPS / 100),
    obligation,
    referrer: none(),
    currentSlot,
    targetLeverage: new Decimal(LEVERAGE),
    selectedTokenMint: address(COLL_MINT), // user deposits collateral (USDG)
    obligationTypeTagOverride: sdk.ObligationTypeTag.Multiply,
    scopeRefreshIx,
    budgetAndPriorityFeeIxs: computeIxs,
    quoteBufferBps: new Decimal(100),
    quoter: getKswapQuoter(),
    swapper: getKswapSwapper(),
    useV2Ixs: true,
  });

  console.log(`\n✓ Routes: ${routes.length}`);
  const bestRoute = routes.reduce((b, c) => {
    const sz = r => r.ixs.reduce((t, ix) => t + (ix.accounts?.length ?? 0) * 32 + (ix.data?.length ?? 0), 0);
    return sz(b) <= sz(c) ? b : c;
  });
  console.log(`Best: ${bestRoute.ixs.length} ixs`);
  for (const ix of bestRoute.ixs) {
    console.log(`  ${String(ix.programAddress).slice(0,12)}... accts=${ix.accounts?.length??0}`);
  }

  // 8. LUTs
  console.log("\n--- 8. LUTs ---");
  const cdnRes = await fetch(`${CDN}/resources.json`);
  const cdnLuts = ((await cdnRes.json())["mainnet-beta"]?.multiplyLUTsPairs?.[COLL_MINT]?.[DEBT_MINT]) ?? [];
  const routeLutAddrs = (bestRoute.lookupTables || []).map(lt => lt.address?.toString()).filter(Boolean);
  const allLutKeys = [...new Set([userLut.toString(), ...cdnLuts, MAIN_MARKET_LUT, ...routeLutAddrs])];

  // Missing account resolution
  const existingLuts = await fetchAllAddressLookupTable(rpc, allLutKeys.map(a => address(a)));
  const covered = new Set();
  for (const lut of existingLuts) for (const a of lut.data.addresses) covered.add(a.toString());
  const ixAccounts = new Set();
  for (const ix of bestRoute.ixs) if (ix.accounts) for (const a of ix.accounts) if (a.address) ixAccounts.add(a.address.toString());
  const missing = [...ixAccounts].filter(a => !covered.has(a));
  console.log(`LUTs: ${allLutKeys.length}, covered: ${covered.size}, missing: ${missing.length}`);

  if (missing.length > 0) {
    const finderRes = await fetch("https://api.kamino.finance/luts/find-minimal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: missing, verify: false }),
    });
    if (finderRes.ok) {
      const extra = (await finderRes.json()).lutAddresses || [];
      for (const l of extra) if (!allLutKeys.includes(l)) allLutKeys.push(l);
      console.log(`+ ${extra.length} resolved, total: ${allLutKeys.length}`);
    }
  }

  // 9. Build + compress
  console.log("\n--- 9. Build ---");
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  let txMsg = pipe(
    createTransactionMessage({ version: 0 }),
    m => appendTransactionMessageInstructions(bestRoute.ixs, m),
    m => setTransactionMessageFeePayerSigner(signer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  );
  console.log(`Ixs: ${txMsg.instructions.length}`);

  const lookups = await fetchAddressesForLookupTables(allLutKeys.map(a => address(a)), rpc);
  txMsg = compressTransactionMessageUsingAddressLookupTables(txMsg, lookups);
  console.log(`Compressed: ${txMsg.instructions.length}`);

  // 10. Send
  console.log("\n--- 10. Send ---");
  const signed = await signTransactionMessageWithSigners(txMsg);
  const sig = getSignatureFromTransaction(signed);
  console.log(`Sig: ${sig}`);

  try {
    await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSub })(signed, {
      commitment: "confirmed", skipPreflight: true,
    });
    console.log(`\n✅ SUCCESS: https://solscan.io/tx/${sig}`);
  } catch (err) {
    console.error(`\n❌ FAILED: ${err.message}`);
    console.error(`https://solscan.io/tx/${sig}`);
  }
}

main().catch(err => { console.error("\n💀", err.message); process.exit(1); });
