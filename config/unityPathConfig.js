import multer from "multer";
import path from "path";
import fs from "fs";
import checkDiskSpace from "check-disk-space";

let UNITY_ROOT = "C:/UnityBuilds";

// auto-select drive
async function setUnityRoot() {
  try {
    const c = await checkDiskSpace("C:");
    const d = await checkDiskSpace("D:");

    UNITY_ROOT = c.free > d.free ? "C:/UnityBuilds" : "D:/UnityBuilds";

    if (!fs.existsSync(UNITY_ROOT)) {
      fs.mkdirSync(UNITY_ROOT, { recursive: true });
    }
  } catch (err) {
    console.log("⚠ Defaulting to C:/UnityBuilds");
  }
}
setUnityRoot();

const TEMP_UPLOAD = path.join(process.cwd(), "temp_all_uploads");

if (!fs.existsSync(TEMP_UPLOAD)) {
  fs.mkdirSync(TEMP_UPLOAD, { recursive: true });
}

// SINGLE ZIP UPLOAD
const unityStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_UPLOAD),
  filename: (req, file, cb) => cb(null, file.originalname),
});

const combinedUpload = multer({
  storage: unityStorage,
  limits: { fileSize: 1024 * 1024 * 2000 }, // 2GB ZIP
});

export { combinedUpload, UNITY_ROOT };
export default combinedUpload;
