# Image d'outils : essai local (wrangler dev) et commandes Cloudflare, sans installer Node.js sur la machine.
# Le site en ligne, lui, tourne chez Cloudflare : cette image ne sert jamais à l'héberger.
FROM node:22-bookworm-slim

# Certificats racine (requis par le moteur local workerd) : copiés depuis Alpine, sans passer par apt.
COPY --from=alpine:3.20 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci && npm cache clean --force
COPY . .
RUN mkdir -p .wrangler donnees && chown -R node:node /app

USER node
ENV WRANGLER_SEND_METRICS=false
EXPOSE 8787

# Site local accessible depuis les autres appareils du réseau : http://<ip-du-serveur>:8787
CMD ["npm", "run", "dev", "--", "--ip", "0.0.0.0", "--port", "8787"]
