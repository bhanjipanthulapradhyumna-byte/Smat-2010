FROM node:20-slim
WORKDIR /workspace/source
COPY pacakage*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
