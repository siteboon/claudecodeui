import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// 用于存储从 busboy 解析出的 directory 字段
const getDirectoryFromReq = (req) => {
  // 优先级：查询参数 > 请求头 > 默认值
  if (req.query.directory) {
    return req.query.directory;
  }
  if (req.headers['x-upload-directory']) {
    return req.headers['x-upload-directory'];
  }
  return '/opt/licc/aicoding/uploads';
};

// 配置存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir = getDirectoryFromReq(req);

    // 如果是相对路径，相对于 server 目录
    if (!path.isAbsolute(uploadDir)) {
      uploadDir = path.join(__dirname, '..', uploadDir);
    }

    // 确保目录存在
    fs.mkdirSync(uploadDir, { recursive: true });

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 保留原始文件名
    cb(null, file.originalname);
  }
});

// 配置文件过滤器（可选，可以限制文件类型）
const fileFilter = (req, file, cb) => {
  // 可以在这里添加文件类型限制
  // 例如：只允许图片文件
  /*
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'), false);
  }
  */
  cb(null, true);
};

// 配置上传中间件
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024 // 限制文件大小为 100MB
  }
});

/**
 * POST /api/upload
 * 上传文件接口
 *
 * 请求参数:
 * - file: 上传的文件（multipart/form-data）
 * - directory: 目标目录（可选，默认为 server/uploads）
 *
 * 返回:
 * - success: 是否成功
 * - path: 文件存放的完整路径
 * - filename: 文件名
 * - size: 文件大小（字节）
 */
router.post('/', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '未找到上传的文件'
      });
    }

    const file = req.file;
    const filePath = file.path;
    const fileName = file.filename;

    res.json({
      success: true,
      path: filePath,
      filename: fileName,
      size: file.size,
      mimetype: file.mimetype
    });
  } catch (error) {
    console.error('文件上传错误:', error);
    res.status(500).json({
      success: false,
      error: '文件上传失败: ' + error.message
    });
  }
});

/**
 * POST /api/upload/multiple
 * 上传多个文件接口
 *
 * 请求参数:
 * - files: 上传的文件数组（multipart/form-data）
 * - directory: 目标目录（可选，默认为 server/uploads）
 *
 * 返回:
 * - success: 是否成功
 * - files: 文件信息数组
 */
router.post('/multiple', upload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: '未找到上传的文件'
      });
    }

    const files = req.files.map(file => ({
      path: file.path,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype
    }));

    res.json({
      success: true,
      count: files.length,
      files: files
    });
  } catch (error) {
    console.error('文件上传错误:', error);
    res.status(500).json({
      success: false,
      error: '文件上传失败: ' + error.message
    });
  }
});

export default router;
