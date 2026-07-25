FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
# Node 24 roda .ts direto, sem passo de build. Ponto de entrada: src/server.ts
CMD ["node", "src/server.ts"]
