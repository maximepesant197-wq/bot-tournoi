   FROM node:20
   RUN npm i -g pnpm@9.12.3
   WORKDIR /app
   COPY . .
   RUN pnpm install
   RUN pnpm run build
   CMD ["node", "artifacts/api-server/dist/index.js"]
