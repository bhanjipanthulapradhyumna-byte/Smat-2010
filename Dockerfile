FROM node:20-bookworm-slim

WORKDIR /workspace/source

# Install GNU Octave so SMAT can execute MATLAB-compatible .m files.
RUN apt-get update \
    && apt-get install -y --no-install-recommends octave \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV OCTAVE_COMMAND=octave-cli

EXPOSE 3000

CMD ["npm", "start"]
