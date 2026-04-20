FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY ./ ./
RUN npm run build

FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS final
RUN apk add --no-cache tzdata
ENV TZ=UTC
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules/
COPY --from=builder /app/build/ ./build/
COPY --from=builder /app/src/scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
