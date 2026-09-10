# ponytail: the app is a static export, so the runtime is a file server and
# nothing else — no Node in the final image, nothing to keep alive but nginx.
# Swap in Caddy if you ever want automatic TLS without Cloudflare in front.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/out /usr/share/nginx/html
# nginx's mime.types has no .mjs, so pdf.js's worker would be served as
# octet-stream and the browser would refuse to import it as a module.
RUN sed -i 's|application/javascript  *js;|application/javascript js mjs;|' /etc/nginx/mime.types \
 && grep -q 'js mjs;' /etc/nginx/mime.types
# next export writes /compress.html, but the links point at /compress.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri.html $uri/ /404.html; }\n}\n' > /etc/nginx/conf.d/default.conf
