import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Aegis Agent API (Stellar + Celo)",
      version: "0.1.0",
      description:
        "Discover, call, and verify Aegis agents on Stellar and Celo using x402 payments and signed run receipts.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/health": {
        get: {
          summary: "Deployment and x402 readiness",
          responses: {
            "200": { description: "Health status" },
          },
        },
      },
      "/api/run": {
        post: {
          summary: "Run a multi-agent pipeline task (Stellar or Celo)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["task"],
                  properties: {
                    task: { type: "string", description: "The prompt to run through the agent pipeline" },
                    chain: { type: "string", enum: ["stellar", "celo"], default: "stellar" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Server-Sent Events stream of pipeline progress and final report",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
          },
        },
      },
      "/api/agents": {
        get: {
          summary: "Discover Aegis agents",
          parameters: [
            { name: "capability", in: "query", schema: { type: "string" } },
            { name: "chain", in: "query", schema: { type: "string", enum: ["stellar", "celo"] } },
            { name: "protocol", in: "query", schema: { type: "string" } },
            { name: "asset", in: "query", schema: { type: "string" } },
            { name: "network", in: "query", schema: { type: "string" } },
            { name: "minReputation", in: "query", schema: { type: "number" } },
          ],
          responses: {
            "200": {
              description: "Agent manifest list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentList" },
                },
              },
            },
          },
        },
      },
      "/api/agents/{id}/run": {
        post: {
          summary: "Call one external Aegis agent",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "PAYMENT-SIGNATURE",
              in: "header",
              schema: { type: "string" },
              description: "x402 payment payload header from an x402 client.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["task"],
                  properties: { task: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Agent result and verifiable run receipt",
              headers: {
                "PAYMENT-RESPONSE": {
                  schema: { type: "string" },
                  description: "x402 settlement response when payment settled.",
                },
              },
            },
            "402": {
              description: "x402 payment required or failed verification",
              headers: {
                "PAYMENT-REQUIRED": {
                  schema: { type: "string" },
                  description: "Base64-encoded x402 PaymentRequired challenge.",
                },
              },
            },
          },
        },
      },
      "/api/receipts/{id}": {
        get: {
          summary: "Fetch a run receipt and verification result",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Receipt plus verification result" },
            "404": { description: "Receipt not found" },
          },
        },
      },
      "/api/receipts/{id}/verify": {
        get: {
          summary: "Verify receipt hash, output hash, and signature",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Verification result" },
            "404": { description: "Receipt not found" },
          },
        },
      },
    },
    components: {
      schemas: {
        AgentList: {
          type: "object",
          required: ["count", "agents"],
          properties: {
            count: { type: "integer" },
            agents: {
              type: "array",
              items: { $ref: "#/components/schemas/AgentManifest" },
            },
          },
        },
        AgentManifest: {
          type: "object",
          required: ["id", "name", "capabilities", "payments", "manifestHash"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            version: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } },
            chain: { type: "string" },
            endpoint: { type: "object" },
            payments: { type: "array", items: { type: "object" } },
            policies: { type: "object" },
            manifestHash: { type: "string" },
            registryContractId: { type: "string" },
            shieldContractId: { type: "string" },
            metadata: { type: "object" },
          },
        },
      },
    },
  });
}
