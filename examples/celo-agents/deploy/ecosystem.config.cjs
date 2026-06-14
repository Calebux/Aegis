module.exports = {
  apps: [
    {
      name: "celo-agents",
      script: "dist/server.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        CELO_RPC_URL: "https://forno.celo.org",
      },
    },
  ],
};
