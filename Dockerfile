# API server + trading loop. Run exactly ONE instance — never scale
# horizontally, or every replica will place its own orders.
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY . .
# Keep the pnpm workspace layout so externalised deps (ccxt, viem) resolve.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @workspace/api-server run build \
 && chown -R node:node /app
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/healthz/deep').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/docker-entrypoint.sh"]
