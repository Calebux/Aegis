FROM node:22-alpine

WORKDIR /app

COPY . .

RUN npm install

RUN npm run build --workspace=apps/dashboard

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "run", "start", "--workspace=apps/dashboard"]
