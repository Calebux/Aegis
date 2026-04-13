/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@aegis/shared", "@calebux/agent-kit", "@aegis/orchestrator"],
  webpack(config) {
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
