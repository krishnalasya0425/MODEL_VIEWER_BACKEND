import { NodeIO } from "@gltf-transform/core";
import { dedup, weld } from "@gltf-transform/functions";
import fs from "fs";
import path from "path";
import multer from "multer";
import { GridFsStorage } from "multer-gridfs-storage";
import dotenv from "dotenv";
import os from "os";
import { Readable } from "stream";

dotenv.config();

const mongoURI = process.env.MONGO_URI;

const storage = new GridFsStorage({
  url: mongoURI,
  file: async (req, file) => {                                           
    const ext = file.originalname.split(".").pop().toLowerCase();
    const allowedExts = ["glb", "gltf", "fbx", "obj"];
    if (!allowedExts.includes(ext)) return null;
     
    let filename = `${Date.now()}-${file.originalname.replace(/\.(gltf|glb)$/, ".glb")}`;
    let bucketName = "fs";                    
    let metadata = { contentType: "model/gltf-binary" };

    let streamOverride = null;

    // ✅ Handle .gltf → .glb conversion
    if (ext === "gltf") {
      try {
        const io = new NodeIO().registerExtensions();
        const tmpIn = path.join(os.tmpdir(), `${Date.now()}-${file.originalname}`);
        const tmpOut = path.join(os.tmpdir(), `${Date.now()}-${path.basename(file.originalname, ".gltf")}.glb`);

        // Write incoming stream to a temp file
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(tmpIn);
          file.stream.pipe(ws).on("finish", resolve).on("error", reject);
        });

        // Convert GLTF → GLB and optimize
        const doc = io.read(tmpIn);
        await doc.transform(dedup(), weld());
        const glbBuffer = io.writeBinary(doc);

        // Clean up
        fs.unlink(tmpIn, () => {});

        // Create readable stream from buffer
        streamOverride = Readable.from(glbBuffer);
        filename = `${Date.now()}-${file.originalname.replace(/\.gltf$/, ".glb")}`;
        metadata = { contentType: "model/gltf-binary", source: "converted-from-gltf" };
      } catch (err) {
        console.error("❌ GLTF to GLB conversion failed:", err);
        return null;
      }
    } else {
      // ✅ Set proper MIME type for other formats
      const mimeMap = {
        glb: "model/gltf-binary",
        fbx: "application/octet-stream",
        obj: "text/plain",
      };
      metadata = { contentType: mimeMap[ext] || "application/octet-stream" };
    }

    return streamOverride
      ? {
          filename,
          bucketName,
          metadata,
          file: streamOverride, // custom stream
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
