/**
 * Agent-optimized routes — strict defaults, one correct response per call.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discoverService } from "../discover/service.js";
import { monitorService } from "../monitor/service.js";
import { APP_URL, FRONTEND_URL } from "../shared/constants.js";

const YieldsQuery = z.object({
  asset_class: z.string().optional().default("stablecoin"),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const DepositLinkBody = z.object({
  opportunity_id: z.coerce.number().int().positive(),
  amount: z.string().min(1),
  leverage: z.coerce.number().optional(),
  slippageBps: z.coerce.number().int().optional(),
});

const WithdrawLinkBody = z.object({
  opportunity_id: z.coerce.number().int().positive(),
  amount: z.string().min(1),
});

function buildSignUrl(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  extra?: { leverage?: number; slippageBps?: number },
): string {
  const actionUrl = new URL(`${APP_URL}/api/manage/actions/${action}`);
  actionUrl.searchParams.set("opportunity_id", String(opportunityId));
  actionUrl.searchParams.set("amount", amount);
  if (extra?.leverage != null) actionUrl.searchParams.set("leverage", String(extra.leverage));
  if (extra?.slippageBps != null) actionUrl.searchParams.set("slippageBps", String(extra.slippageBps));
  return `${FRONTEND_URL}/sign?action=${encodeURIComponent(actionUrl.toString())}`;
}

export async function agentRoutes(app: FastifyInstance) {
  // GET /yields — top stablecoin yields by default
  app.get("/yields", async (request) => {
    const query = YieldsQuery.parse(request.query);
    const result = await discoverService.searchYields({
      asset_class: query.asset_class === "all" ? undefined : query.asset_class,
      sort: "apy_desc",
      limit: query.limit,
    });

    return {
      yields: result.data.map((y) => ({
        id: y.id,
        name: y.name,
        protocol: y.protocol_name,
        apy: y.apy_current,
        tvl_usd: y.tvl_usd,
        risk_tier: y.risk_tier,
        category: y.category,
        tokens: y.tokens,
      })),
      next: 'To deposit, call: POST /api/agent/deposit-link { "opportunity_id": <id>, "amount": "<amount>" }',
    };
  });

  // POST /deposit-link — returns ONE signing URL, no wallet needed
  app.post("/deposit-link", async (request, reply) => {
    const body = DepositLinkBody.parse(request.body);
    const opp = await discoverService.getOpportunityById(body.opportunity_id);
    if (!opp) return reply.status(404).send({ message: "Opportunity not found" });

    const signUrl = buildSignUrl("deposit", body.opportunity_id, body.amount, {
      leverage: body.leverage,
      slippageBps: body.slippageBps,
    });

    return {
      sign_url: signUrl,
      summary: `Deposit ${body.amount} into ${opp.name} (~${opp.apy_current?.toFixed(1)}% APY)`,
      next: "Show the sign_url to the user. They click it, connect their wallet, and sign.",
    };
  });

  // POST /withdraw-link — returns ONE signing URL, no wallet needed
  app.post("/withdraw-link", async (request, reply) => {
    const body = WithdrawLinkBody.parse(request.body);
    const opp = await discoverService.getOpportunityById(body.opportunity_id);
    if (!opp) return reply.status(404).send({ message: "Opportunity not found" });

    const signUrl = buildSignUrl("withdraw", body.opportunity_id, body.amount);

    return {
      sign_url: signUrl,
      summary: `Withdraw ${body.amount} from ${opp.name}`,
      next: "Show the sign_url to the user. They click it, connect their wallet, and sign.",
    };
  });

  // GET /portfolio/:wallet — combined positions + analytics in one call
  app.get<{ Params: { wallet: string } }>("/portfolio/:wallet", async (request) => {
    const wallet = request.params.wallet;

    // Auto-track if not tracked yet
    const status = await monitorService.getWalletStatus(wallet);
    if (!status) {
      await monitorService.trackWallet(wallet);
      return {
        status: "fetching",
        next: "Wallet is being tracked for the first time. Try again in 10 seconds.",
      };
    }

    if (status.fetch_status === "fetching") {
      return {
        status: "fetching",
        next: "Portfolio is still loading. Try again in 10 seconds.",
      };
    }

    const [portfolio, analytics] = await Promise.all([
      monitorService.getPortfolioPositions(wallet),
      monitorService.getPortfolioAnalytics(wallet),
    ]);

    return {
      status: "ready",
      summary: analytics.summary,
      stablecoin: analytics.stablecoin,
      positions: portfolio.positions.map((p) => ({
        id: p.id,
        protocol: p.protocol_slug,
        product_type: p.product_type,
        opportunity_id: p.opportunity_id,
        deposit_amount_usd: p.deposit_amount_usd,
        pnl_usd: p.pnl_usd,
        pnl_pct: p.pnl_pct,
        apy: p.apy,
        token_symbol: p.token_symbol,
      })),
      next: 'To deposit more, call: POST /api/agent/deposit-link { "opportunity_id": <id>, "amount": "<amount>" }',
    };
  });
}
