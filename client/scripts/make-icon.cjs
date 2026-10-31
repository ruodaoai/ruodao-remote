const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const outDir = path.resolve(__dirname, "..", "build");
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const allSizes = [...icoSizes, 1024];

app.disableHardwareAcceleration();

function iconSvg(size) {
  const small = size <= 32;
  const margin = small ? 18 : 46;
  const tile = 1024 - margin * 2;
  const radius = Math.round(tile * 0.238);
  const glyphScale = small ? 30.4 : 29.2;
  const strokeWidth = small ? 2.34 : 2.06;
  const depth = small
    ? ""
    : `<rect x="${margin}" y="${margin}" width="${tile}" height="${tile}" rx="${radius}" fill="url(#gloss)"/>
       <rect x="${margin}" y="${margin}" width="${tile}" height="${tile}" rx="${radius}" fill="url(#sheen)"/>
       <rect x="${margin + 5}" y="${margin + 5}" width="${tile - 10}" height="${tile - 10}" rx="${radius - 5}"
         fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="4"/>`;
  const lift = small
    ? ""
    : `<filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
         <feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#7c1b05" flood-opacity="0.3"/>
       </filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="150" y1="90" x2="880" y2="950" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff9a6b"/>
      <stop offset="0.48" stop-color="#f5522b"/>
      <stop offset="1" stop-color="#dd2f0b"/>
    </linearGradient>
    <radialGradient id="gloss" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
      gradientTransform="translate(318 236) scale(742)">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="0.52" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="180" y1="860" x2="860" y2="170" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.09"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    ${lift}
  </defs>
  <rect x="${margin}" y="${margin}" width="${tile}" height="${tile}" rx="${radius}" fill="url(#bg)"/>
  ${depth}
  <g transform="translate(512 512) scale(${glyphScale}) translate(-12 -12)"
     ${small ? "" : 'filter="url(#lift)"'} fill="none" stroke="#ffffff"
     stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </g>
</svg>`;
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, data }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false },
  });

  try {
    await win.loadURL("data:text/html,<html><body></body></html>");
    const rendered = await win.webContents.executeJavaScript(`(async () => {
      const iconSvg = (${iconSvg.toString()});
      const sizes = ${JSON.stringify(allSizes)};
      const outputs = [];
      for (const size of sizes) {
        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(iconSvg(size));
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        outputs.push({ size, data: canvas.toDataURL("image/png").split(",")[1] });
      }
      return outputs;
    })()`);

    const outputs = new Map(
      rendered.map(({ size, data }) => [size, Buffer.from(data, "base64")]),
    );
    mkdirSync(outDir, { recursive: true });
    const ico = buildIco(icoSizes.map((size) => ({ size, data: outputs.get(size) })));
    writeFileSync(path.join(outDir, "icon.ico"), ico);
    writeFileSync(path.join(outDir, "icon.png"), outputs.get(1024));
    writeFileSync(path.join(outDir, "icon.svg"), iconSvg(1024));
    console.log(`wrote icon.ico (${icoSizes.length} sizes), icon.png, icon.svg to ${outDir}`);
  } finally {
    win.destroy();
    app.quit();
  }
});
