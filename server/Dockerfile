# The relay is one file and one dependency, so there is nothing to compile and
# no build stage to copy out of. `npm ci --omit=dev` is the whole install.
FROM node:22-alpine

WORKDIR /app

# Only the manifests, so a change to relay.mjs does not invalidate the install
# layer. `npm ci` needs the lockfile and refuses to run without it, which is the
# point: the relay's one dependency is pinned and must resolve to the pinned
# version rather than whatever is current.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server/relay.mjs ./server/relay.mjs

# node:alpine ships an unprivileged `node` user already. The relay writes
# nothing, binds a high port and needs no capabilities, so there is no reason
# for it to be root and every reason for it not to be.
USER node

ENV NODE_ENV=production
ENV DICEBOX_PORT=8787
# Loopback is the right default on a host and the wrong one in a container:
# nothing outside the network namespace could reach it, including the health
# check from the daemon's perspective and the reverse proxy in front. Compose
# sets this too; it is here so a plain `docker run` also works.
ENV DICEBOX_BIND=0.0.0.0

EXPOSE 8787

# /health reports counts only — never room ids — so it is safe for a probe that
# ends up in daemon logs. Node itself does the request: the image has no wget or
# curl, and adding one to run a health check would be a second network client in
# an image that otherwise has none.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DICEBOX_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the relay is PID 1 and receives SIGTERM directly. Under the
# shell form it would sit behind /bin/sh, which does not forward signals, and
# the going_away frame that stops clients stampeding a restarting relay would
# never be sent.
CMD ["node", "server/relay.mjs"]
