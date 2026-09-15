FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .

EXPOSE 4000

CMD ["npm", "start"]