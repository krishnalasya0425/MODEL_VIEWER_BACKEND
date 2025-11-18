// decompress-webgl.js
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const WEBGL_ROOT = path.join(process.cwd(), 'public', 'webgl-builds');

function decompressAllFiles(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    
    if (fs.statSync(fullPath).isDirectory()) {
      decompressAllFiles(fullPath);
    } else if (file.endsWith('.gz')) {
      const originalPath = fullPath.replace(/\.gz$/, '');
      console.log(`Decompressing: ${file}`);
      
      try {
        const gzBuffer = fs.readFileSync(fullPath);
        const decompressed = zlib.gunzipSync(gzBuffer);
        fs.writeFileSync(originalPath, decompressed);
        console.log(`✅ Decompressed: ${path.basename(originalPath)}`);
        
        // Optionally remove the .gz file
        // fs.unlinkSync(fullPath);
      } catch (err) {
        console.error(`❌ Error decompressing ${file}:`, err);
      }
    }
  });
}

console.log('🚀 Starting WebGL file decompression...');
decompressAllFiles(WEBGL_ROOT);
console.log('🎉 All WebGL files decompressed!');