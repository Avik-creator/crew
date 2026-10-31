// Builds the Crew computer image on E2B: their desktop template plus the tools
// bots need (supervisord, Node, uv, Playwright). Run: pnpm template:build
// Then set E2B_TEMPLATE_ID to the printed name.
import { defaultBuildLogger, Template } from "e2b"

const name = process.env.E2B_TEMPLATE_NAME || "crew-computer"

const template = Template()
  .fromTemplate("desktop")
  .setUser("root")
  .aptInstall(["supervisor", "xdotool", "scrot", "x11vnc", "curl", "ca-certificates", "jq", "git", "ripgrep"], {
    noInstallRecommends: true,
  })
  .runCmd([
    "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
    "DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
    "npm install -g supergateway@3",
    "curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh",
    // supervisord runs as root; programs drop to "user"
    "sed -i 's/^chmod=0700/chmod=0770/' /etc/supervisor/supervisord.conf",
  ])
  .setUser("user")
  .runCmd([
    "python3 -m pip install --user -q playwright==1.58.0",
    "mkdir -p /home/user/workspace/.sessions /home/user/.crew",
  ])

const info = await Template.build(template, {
  alias: name,
  cpuCount: 4,
  memoryMB: 8192,
  onBuildLogs: defaultBuildLogger(),
})

console.log("\nBuilt template:", info)
console.log(`Set E2B_TEMPLATE_ID=${name} in .env`)
