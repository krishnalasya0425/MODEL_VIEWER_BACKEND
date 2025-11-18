import multer from "multer";
import path from "path";
import fs from "fs";

const TEMP_ROOT = path.join(process.cwd(), "temp_all_uploads");

if (!fs.existsSync(TEMP_ROOT)) {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, TEMP_ROOT);
  },

  filename: function (req, file, cb) {

    // Ensure nested folder structure for Unity
    const fullPath = path.join(TEMP_ROOT, file.originalname);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    cb(null, file.originalname);
  }
});

const combinedUpload = multer({
  storage,
  preservePath: true,
});

export default combinedUpload;
