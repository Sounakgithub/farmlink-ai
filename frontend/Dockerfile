# Build the static app, then serve it with nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The browser calls these directly, so they must be reachable from the user's machine.
ARG VITE_API_BASE=http://localhost:5000/api
ARG VITE_ML_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE VITE_ML_BASE=$VITE_ML_BASE
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
