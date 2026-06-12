const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@aegis/shared", "@calebux/agent-kit", "@aegis/orchestrator"],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/paywall": false,
    };
    // Allow TypeScript source files in workspace packages that use .js extensions
    // in their imports (TypeScript ESM convention) to be resolved by webpack.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

module.exports = nextConfig;
