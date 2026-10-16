# Clariva Web image (see docs/clariva/DEPLOY.md)
#
#   docker build -t clariva-web --build-arg VERSION=26.10.1 .
#   docker run --rm -p 8080:80 clariva-web
#
# The build context is the repository root: the Element Web shell plus the vendored matrix-react-sdk workspace in
# packages/matrix-react-sdk. No SDK repositories are cloned (the stock USE_CUSTOM_SDKS / docker-link-repos.sh mechanism
# does not apply to a vendored SDK) and no git metadata is needed.

# Builder
FROM --platform=$BUILDPLATFORM node:20-bullseye AS builder

# App version shown in Settings > Help & About and written to /version. CalVer YY.MM.N like the Android app.
ARG VERSION=dev
# The runtime config baked into the image as /app/config.json. config.clariva.json is the production config;
# override it at run time by mounting a file over /app/config.json or by serving config.<hostname>.json next to it.
ARG CLARIVA_CONFIG=config.clariva.json
# Absolute URL of the og:image (leave empty for the default in webpack.config.js)
ARG RIOT_OG_IMAGE_URL=

ENV NODE_OPTIONS=--max-old-space-size=4096
ENV RIOT_OG_IMAGE_URL=${RIOT_OG_IMAGE_URL}

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY . /src
# Plain `yarn install` also works if the lockfile is intentionally out of date.
RUN yarn --network-timeout=200000 install --frozen-lockfile

RUN VERSION="${VERSION}" yarn build && echo "${VERSION}" > /src/webapp/version

# Copy the config now so that we don't create another layer in the app image
RUN cp "/src/${CLARIVA_CONFIG}" /src/webapp/config.json

# App
FROM nginx:alpine-slim

COPY --from=builder /src/webapp /app

# Override default nginx config (default.conf + optional clariva-*.locations snippets, e.g. the Wallet-API proxy)
COPY /nginx/conf.d/ /etc/nginx/conf.d/

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html

EXPOSE 80
