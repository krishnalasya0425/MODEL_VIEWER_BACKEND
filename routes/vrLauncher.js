import express from "express";
const router = express.Router();

// match frontend POST /api/system/launch-unity-vr
router.post("/launch-unity-vr", (req, res) => {
  console.log("Unity launch skipped — WebVR handled in frontend.");
  res.json({ success: true, message: "VR launched in browser (no Unity build)" });
});

export default router;
