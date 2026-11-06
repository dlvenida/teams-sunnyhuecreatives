FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# Railway injects NODE_ENV=production for the build. npm ci then skips
# devDependencies, and `tsc -b` fails with TS2688 because vite/client and
# @types/node are not installed. Always install the build tooling.
RUN npm ci --include=dev
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
# Railway provides $PORT; local docker-compose defaults to 80
ENV PORT=80
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
