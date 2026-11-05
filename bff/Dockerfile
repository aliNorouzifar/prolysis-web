# Prolysis BFF — GraphQL Yoga server (TypeScript, run via tsx).
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8080
CMD ["npm", "start"]
