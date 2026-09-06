FROM node:20
RUN npm i -g pnpm@9.12.3
WORKDIR /app
COPY . .
ENV PORT=3000
ENV NODE_ENV=production
RUN pnpm install
RUN pnpm --filter ./artifacts/api-server... build
RUN ls -la artifacts/api-server/dist || ls -la artifacts/api-server
CMD ["pnpm", "--filter", "./artifacts/api-server", "start"]
