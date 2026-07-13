FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --ignore-scripts
COPY . .
RUN npm rebuild sharp && npm run build

FROM node:24-bookworm-slim
ARG APP_COMMIT_SHA=unknown
ENV NODE_ENV=production PORT=8788 HOST=0.0.0.0 CAISHEN_DATA_DIR=/data APP_COMMIT_SHA=${APP_COMMIT_SHA}
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev
VOLUME ["/data"]
EXPOSE 8788
CMD ["npm", "start"]
