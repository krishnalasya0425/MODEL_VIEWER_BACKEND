import multer from "multer";
import path from "path";

// Memory storage only - NO DISK STORAGE
const storage = multer.memoryStorage();

const combinedUpload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 * 1024, // 50GB
    fieldSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    // Allow chunks without file extensions
    if (file.fieldname === 'chunk') {
      return cb(null, true);
    }

    const allowedTypes = [
      ".zip", ".7z", ".rar", ".gz", ".tar",
      ".fbx", ".glb", ".gltf",
      ".unityweb", ".json"
    ];
    
    // 🟢 FIXED: Use path.extname() instead of file.extname()
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (!ext) {
      return cb(new Error(`❌ File has no extension: ${file.originalname}`));
    }
    
    if (!allowedTypes.includes(ext)) {
      return cb(new Error(`❌ File type not allowed: ${ext}`));
    }
    
    cb(null, true);
  }
});

// Remove UNITY_ROOT export
export { combinedUpload };
export default combinedUpload;