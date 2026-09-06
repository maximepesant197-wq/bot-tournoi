FROM node:20
RUN npm i -g pnpm@9.12.3
WORKDIR /app
COPY . .
ENV PORT=3000
RUN pnpm install
RUN pnpm --filter @workspace/api-server... build
CMD ["node", "artifacts/api-server/dist/index.js"]
