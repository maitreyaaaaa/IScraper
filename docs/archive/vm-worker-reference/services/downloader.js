const path = require('path');
const fs = require('fs');
const ytdlp = require('yt-dlp-exec');

async function downloadInstagramMedia({ url, outputDir, id }) {
  const outputPath = path.join(outputDir, `${id}-%(playlist_index)s.%(ext)s`);
  const result = await ytdlp.exec(url, {
    output: outputPath,
    format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    noWarnings: true,
  });
  return {
    outputPaths: findDownloadedFiles(outputDir, id),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function findDownloadedFiles(outputDir, id) {
  if (!fs.existsSync(outputDir)) return null;
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.startsWith(`${id}`))
    .map((name) => path.join(outputDir, name));
}

module.exports = {
  downloadInstagramMedia,
};
