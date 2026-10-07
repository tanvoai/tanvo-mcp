# For registries that build and introspect the server (Glama, Smithery). Runs over stdio.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm install --no-save typescript @types/node
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev
ENTRYPOINT ["node", "dist/index.js"]
