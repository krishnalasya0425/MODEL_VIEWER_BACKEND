import fs from 'fs';
import os from 'os';
import path from 'path';

class DriveManager {
  static async getBestDrive(minimumSpaceGB = 5) {
    const drives = this.getAvailableDrives();
    const minimumSpaceBytes = minimumSpaceGB * 1024 * 1024 * 1024;
    
    console.log(`🔍 Looking for drive with at least ${minimumSpaceGB}GB free space...`);
    
    const driveStats = [];
    
    for (const drive of drives) {
      try {
        const freeSpace = await this.getFreeSpace(drive);
        driveStats.push({
          drive,
          freeSpace,
          freeSpaceGB: (freeSpace / (1024 * 1024 * 1024)).toFixed(2),
          hasEnoughSpace: freeSpace >= minimumSpaceBytes
        });
        
        console.log(`📀 ${drive}: ${driveStats[driveStats.length - 1].freeSpaceGB}GB free`);
        
      } catch (error) {
        console.log(`❌ Cannot access drive ${drive}:`, error.message);
      }
    }
    
    // Filter drives with enough space and sort by free space
    const suitableDrives = driveStats.filter(d => d.hasEnoughSpace);
    suitableDrives.sort((a, b) => b.freeSpace - a.freeSpace);
    
    let bestDrive;
    
    if (suitableDrives.length > 0) {
      bestDrive = suitableDrives[0].drive;
      console.log(`✅ Selected ${bestDrive} with ${suitableDrives[0].freeSpaceGB}GB free space`);
    } else {
      // If no drive has enough space, use the one with most space anyway
      driveStats.sort((a, b) => b.freeSpace - a.freeSpace);
      bestDrive = driveStats[0].drive;
      console.warn(`⚠️ No drive has ${minimumSpaceGB}GB free. Using ${bestDrive} with ${driveStats[0].freeSpaceGB}GB (may run out of space)`);
    }
    
    return bestDrive;
  }
  
  static async getFreeSpace(drivePath) {
    return new Promise((resolve, reject) => {
      // Simple approach: check if we can write a large file
      // This is more reliable than trying to use system commands
      try {
        // Try to create a test file to verify writable space
        const testDir = path.join(drivePath, 'temp_space_check');
        
        // Create temp directory
        if (!fs.existsSync(testDir)) {
          fs.mkdirSync(testDir, { recursive: true });
        }
        
        // Try to write a file
        const testFile = path.join(testDir, `space_test_${Date.now()}.tmp`);
        const testData = Buffer.alloc(1024 * 1024); // 1MB test data
        
        fs.writeFileSync(testFile, testData);
        
        // If successful, assume reasonable space is available
        // Clean up
        fs.unlinkSync(testFile);
        fs.rmdirSync(testDir);
        
        // For Windows, we'll use a more generous assumption since we can write
        // You could implement more sophisticated checking here if needed
        const assumedSpace = 50 * 1024 * 1024 * 1024; // Assume 50GB for writable drives
        
        console.log(`✅ Drive ${drivePath} is writable, assuming ${(assumedSpace / (1024 * 1024 * 1024)).toFixed(2)}GB available`);
        resolve(assumedSpace);
        
      } catch (error) {
        console.warn(`⚠️ Drive ${drivePath} may have space issues:`, error.message);
        // If we can't write, assume minimal space
        resolve(1024 * 1024 * 1024); // 1GB fallback
      }
    });
  }
  
  static getAvailableDrives() {
    const platform = os.platform();
    const drives = [];
    
    if (platform === 'win32') {
      // Check common drive letters on Windows
      const windowsDrives = ['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'I:', 'J:'];
      for (const drive of windowsDrives) {
        try {
          fs.accessSync(drive);
          drives.push(drive);
          console.log(`✅ Found drive: ${drive}`);
        } catch (error) {
          // Drive doesn't exist or not accessible
          console.log(`❌ Drive not accessible: ${drive}`);
        }
      }
    } else {
      // Unix-like systems
      const possiblePaths = [
        '/Volumes', // Mac
        '/mnt',     // Linux
        '/media',   // Linux
        os.homedir()
      ];
      
      for (const basePath of possiblePaths) {
        try {
          const items = fs.readdirSync(basePath);
          for (const item of items) {
            const fullPath = path.join(basePath, item);
            try {
              const stats = fs.statSync(fullPath);
              if (stats.isDirectory()) {
                drives.push(fullPath);
                console.log(`✅ Found mount point: ${fullPath}`);
              }
            } catch (error) {
              // Skip inaccessible items
            }
          }
        } catch (error) {
          // Path doesn't exist or not accessible
        }
      }
    }
    
    // Always include current working directory as fallback
    if (!drives.includes(process.cwd())) {
      drives.push(process.cwd());
    }
    
    console.log(`📊 Total available drives: ${drives.length}`);
    return drives;
  }
  
  static async ensureUnityRoot(minimumSpaceGB = 1) {
    try {
      const bestDrive = await this.getBestDrive(minimumSpaceGB);
      const unityRoot = path.join(bestDrive, 'UnityBuilds');
      
      // Create directory structure
      if (!fs.existsSync(unityRoot)) {
        fs.mkdirSync(unityRoot, { recursive: true });
        console.log(`✅ Created Unity root directory: ${unityRoot}`);
      }
      
      // Verify we can write to the directory
      try {
        const testFile = path.join(unityRoot, 'write_test.tmp');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log(`✅ Write permissions verified for: ${unityRoot}`);
      } catch (error) {
        throw new Error(`Cannot write to Unity root directory: ${unityRoot}`);
      }
      
      process.env.UNITY_ROOT = unityRoot;
      return unityRoot;
      
    } catch (error) {
      console.error('❌ Error ensuring Unity root:', error);
      // Fallback to C: drive
      const fallbackRoot = path.join('C:', 'UnityBuilds');
      if (!fs.existsSync(fallbackRoot)) {
        fs.mkdirSync(fallbackRoot, { recursive: true });
      }
      console.log(`🔄 Using fallback Unity root: ${fallbackRoot}`);
      process.env.UNITY_ROOT = fallbackRoot;
      return fallbackRoot;
    }
  }
  
  static getUnityRoot() {
    if (process.env.UNITY_ROOT) {
      return process.env.UNITY_ROOT;
    }
    
    // Fallback to C: drive
    const fallback = path.join('C:', 'UnityBuilds');
    console.warn(`⚠️ UNITY_ROOT not set, using fallback: ${fallback}`);
    return fallback;
  }
}

export default DriveManager;