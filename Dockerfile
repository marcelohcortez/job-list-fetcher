FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .

EXPOSE 3000

CMD ["npm", "start"]