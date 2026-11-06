# syntax=docker/dockerfile:1

# This Dockerfile is intended for CI use only
# It assumes rl-linux-x64-VERSION.tar.xz exists in /packages/insomnia-inso/artifacts
# You can run `npm run package -w restless-cli && npm run artifacts -w restless-cli` on a linux host OR
# download it from https://github.com/outmanos/restless/releases

FROM docker.io/ubuntu:24.04 AS fetch

COPY ./artifacts/rl-linux-*.tar.xz /tmp/rl.tar.xz
RUN apt-get update && apt-get install -y xz-utils && rm -rf /var/lib/apt/lists/*
RUN tar -C /usr/bin -xvf /tmp/rl.tar.xz

FROM docker.io/ubuntu:24.04
COPY --from=fetch /usr/bin/rl /usr/bin/rl
RUN chmod +x /usr/bin/rl
RUN apt-get update && apt-get install -y libstdc++6 && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/bin/rl"]
