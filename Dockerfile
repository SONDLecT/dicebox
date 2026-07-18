# Dicebox is eleven static files with no build step, so this image is just a web
# server with the app copied in. Nothing is compiled and nothing is fetched at
# runtime.
FROM nginx:alpine

COPY index.html style.css app.js dice.js render.js sw.js manifest.webmanifest /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf

EXPOSE 80

# The app is entirely client-side, so a successful fetch of the shell is a
# sufficient health check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost/ || exit 1
