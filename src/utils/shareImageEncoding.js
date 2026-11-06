/** Reuse the prepared share image and reduce its resolution for a smaller download. */
export async function encodeCompactShareJpeg(blob) {
  const image = await createImageBitmap(blob);
  try {
    const width = Math.min(image.width, 1200);
    const height = Math.max(1, Math.round(image.height * width / image.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('分享图画布不可用');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!result || result.type !== 'image/jpeg') throw new Error('JPG 分享图生成失败');
    return result;
  } finally {
    image.close();
  }
}
