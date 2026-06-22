const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@calagent/shared", "@calagent/agent-kit", "@calagent/orchestrator"],
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
