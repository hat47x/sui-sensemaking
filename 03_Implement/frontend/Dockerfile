FROM node:22-alpine AS build
WORKDIR /app

# Public build-time contract key (SUI_* only)
ARG SUI_FRONTEND_API_BASE=/api
ARG SUI_RUNTIME_PROFILE=local-dev
# OPS-OBSERV-01: build revision, surfaced by the support diagnostics bundle.
ARG SUI_APP_REVISION=unknown
ENV SUI_FRONTEND_API_BASE=${SUI_FRONTEND_API_BASE}
ENV SUI_RUNTIME_PROFILE=${SUI_RUNTIME_PROFILE}
ENV SUI_APP_REVISION=${SUI_APP_REVISION}

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
