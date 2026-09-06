FROM node:20
RUN npm i -g pnpm@9.12.3
WORKDIR /app
COPY . .
ENV PORT=3000
RUN pnpm install
RUN pnpm --filter ./artifacts/api-server... build
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "./artifacts/api-server", "start"]
