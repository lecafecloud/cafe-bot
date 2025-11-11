FROM node:20-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
