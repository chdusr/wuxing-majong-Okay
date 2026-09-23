/**
 * Utilities for client-side image compression and avatar processing
 */

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: '请选择有效的图片文件 (JPG, PNG, WebP等)' };
  }
  // Max upload file size before compression: 8MB
  if (file.size > 8 * 1024 * 1024) {
    return { valid: false, error: '图片过大，请选择8MB以内的图片' };
  }
  return { valid: true };
}

/**
 * Resizes and crops an image file to a square avatar of `targetSize x targetSize`
 * and compresses it into an optimized JPEG Data URL (~10-25KB).
 */
export async function compressAvatarImage(
  file: File,
  targetSize = 128,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('读取图片文件失败'));

    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式解析失败'));

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            return reject(new Error('无法创建画布环境'));
          }

          // Center-crop to square
          const { width, height } = img;
          const minDim = Math.min(width, height);
          const sx = (width - minDim) / 2;
          const sy = (height - minDim) / 2;

          // Smooth rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Optional subtle dark background fill for transparent PNGs
          ctx.fillStyle = '#1A102E';
          ctx.fillRect(0, 0, targetSize, targetSize);

          ctx.drawImage(
            img,
            sx,
            sy,
            minDim,
            minDim,
            0,
            0,
            targetSize,
            targetSize
          );

          // Export as JPEG (great compression & universal browser compatibility)
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}
