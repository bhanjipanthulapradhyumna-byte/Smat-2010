FROM node:20-slim
WORKDIR /workspace/source
COPY package*.json ./
RUN npm install
COPY . .

# Let the system dynamic port take control
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
