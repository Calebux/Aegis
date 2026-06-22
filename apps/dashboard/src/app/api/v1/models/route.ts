import { NextResponse } from "next/server";

export async function GET() {
  const models = [
    {
      id: "aegis-base",
      object: "model",
      created: 1715367400,
      owned_by: "calagentkit",
      permission: [],
      root: "aegis-base",
      parent: null,
    },
    {
      id: "aegis-ultra",
      object: "model",
      created: 1715367400,
      owned_by: "calagentkit",
      permission: [],
      root: "aegis-ultra",
      parent: null,
    },
  ];

  return NextResponse.json({
    object: "list",
    data: models,
  });
}
