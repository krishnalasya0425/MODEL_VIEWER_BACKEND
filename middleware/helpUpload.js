// middleware/helpUpload.js
import multer from "multer";
import { GridFsStorage } from "multer-gridfs-storage";
import dotenv from "dotenv";
dotenv.config();

const storage = new GridFsStorage({
  url: process.env.MONGO_URI,
  file: (req, file) => {
    return {
      filename: `${Date.now()}-${file.originalname}`,
      bucketName: "attachments", 
      contentType: file.mimetype, 
    };
  },
});

const upload = multer({ storage });
export default upload;