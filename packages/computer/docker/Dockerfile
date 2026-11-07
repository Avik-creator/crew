# The Crew computer as a local container, for COMPUTER_PROVIDER=docker. It has
# what bots get on E2B: Xfce apps, a browser, VNC with noVNC, supervisord, Node
# and Playwright. Debian, because it packages a real Chromium for Intel and Arm.
# The docker provider builds this by itself; `pnpm computer:docker` builds it ahead.
FROM debian:trixie-20261020-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xfwm4 xfce4-panel xfce4-terminal mousepad thunar galculator \
      x11vnc novnc python3-websockify x11-xserver-utils xdotool scrot dbus-x11 at-spi2-core \
      chromium fonts-liberation fonts-noto-core fonts-noto-color-emoji \
      python3 python3-pip python3-gi gir1.2-atspi-2.0 nodejs npm \
      supervisor sudo curl ca-certificates jq git ripgrep procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g supergateway@3

# Commands run as "user" with sudo, like on E2B. supervisord runs as root and
# lets that user talk to it. Chromium runs unsandboxed: the container is the
# sandbox, and Chromium's own needs privileges a container doesn't give.
RUN useradd -m -s /bin/bash user \
    && echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user \
    && sed -i 's/^chmod=0700/chmod=0770/' /etc/supervisor/supervisord.conf \
    && ln -s /usr/share/novnc /opt/noVNC \
    && echo 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox"' > /etc/chromium.d/crew \
    && dbus-uuidgen --ensure=/etc/machine-id

USER user
RUN python3 -m pip install --user -q playwright==1.58.0 \
    && mkdir -p /home/user/workspace/.sessions /home/user/.crew
USER root

# supervisord keeps the container up and brings the screens back after a restart
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
