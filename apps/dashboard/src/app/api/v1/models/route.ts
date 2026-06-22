import { NextResponse } from "next/server";

export async function GET() {
  const models = [
    {
      id: "calagent-base",
      object: "model",
      created: 1715367400,
      owned_by: "calagentkit",
      permission: [],
      root: "calagent-base",
      parent: null,
    },
    {
      id: "calagent-ultra",
      object: "model",
      created: 1715367400,
      owned_by: "calagentkit",
      permission: [],
      root: "calagent-ultra",
      parent: null,
    },
  ];

  return NextResponse.json({
    object: "list",
    data: models,
  });
}
