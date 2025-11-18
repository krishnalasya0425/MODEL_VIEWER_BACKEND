import multer from "multer";
import path from "path";
import fs from "fs";
import checkDiskSpace from "check-disk-space";

let UNITY_ROOT = "C:/UnityBuilds";

// Auto-select drive based on free space
async function setUnityRoot() {
  try {
    const c = await checkDiskSpace("C:");
    const d = await checkDiskSpace("D:");

    UNITY_ROOT = c.free > d.free ? "C:/UnityBuilds" : "D:/UnityBuilds";

    // Ensure folder exists
    if (!fs.existsSync(UNITY_ROOT)) {
      fs.mkdirSync(UNITY_ROOT, { recursive: true });
    }

    console.log("Unity root set to:", UNITY_ROOT);
  } catch (err) {
    console.log("⚠ Defaulting to C:/UnityBuilds due to error");
  }
}

await setUnityRoot();  // Ensure root is set before multer runs

// STORAGE — directly save to UNITY_ROOT
const unityStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UNITY_ROOT); // save directly to the drive folder
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname); // keep same name
  },
});

// MULTER uploader
const combinedUpload = multer({
  storage: unityStorage,
  limits: { fileSize: 1024 * 1024 * 2000 }, // 2GB
});

export { combinedUpload, UNITY_ROOT };
export default combinedUpload;
