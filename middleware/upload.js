import { NodeIO } from '@gltf-transform/core';
import { dedup, weld } from '@gltf-transform/functions';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { GridFsStorage } from 'multer-gridfs-storage';
import dotenv from 'dotenv';
import os from 'os';
import { Readable } from 'stream';

dotenv.config();
const mongoURI = process.env.MONGO_URI;

const storage = new GridFsStorage({
  url: mongoURI,
  file: async (req, file) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const allowedExts = ['glb', 'gltf', 'fbx', 'obj'];
    if (!allowedExts.includes(ext)) return null;

    // Default file info
    let filename = `${Date.now()}-${file.originalname.replace(/\.(gltf|glb)$/, '.glb')}`;
    let bucketName = 'fs';
    let metadata = { contentType: 'model/gltf-binary' };

    // By default, let multer-gridfs-storage pipe the incoming stream.
    let streamOverride = null;

    if (ext === 'gltf') {
      try {
        const io = new NodeIO().registerExtensions();

        // Write incoming stream to a temp file first (no reliance on file.buffer)
        const tmpIn = path.join(os.tmpdir(), `${Date.now()}-${file.originalname}`);
        const tmpOut = path.join(os.tmpdir(), `${Date.now()}-${path.basename(file.originalname, '.gltf')}.glb`);

        // Pipe incoming stream to disk so NodeIO can read it
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(tmpIn);
          file.stream.pipe(ws).on('finish', resolve).on('error', reject);
        });

        // Convert to GLB
        const doc = io.read(tmpIn);
        await doc.transform(dedup(), weld());
        const glbBuffer = io.writeBinary(doc);

        // Clean up input file
        try { fs.unlinkSync(tmpIn); } catch {}

        // Provide a readable stream to multer-gridfs-storage
        streamOverride = Readable.from(glbBuffer);

        // Set final filename/metadata for GLB
        filename = `${Date.now()}-${file.originalname.replace(/\.gltf$/, '.glb')}`;
        metadata = { contentType: 'model/gltf-binary', source: 'converted-from-gltf' };

      } catch (err) {
        console.error('Error converting GLTF to GLB:', err);
        return null;
      }
    }

    return streamOverride
      ? {
          filename,
          bucketName,
          metadata,
          file: streamOverride,
        }
      : {
          filename,
          bucketName,
          metadata,
        };
  },
});

const upload = multer({ storage });
export default upload;
